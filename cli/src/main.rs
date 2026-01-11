// Design: see README.md for the signaling flow; related to src/client/room.tsx.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use bytes::Bytes;
use clap::{Parser, Subcommand};
use futures_util::{SinkExt, StreamExt};
use getrandom::getrandom;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, Mutex};
use tokio::time::{sleep, Duration};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use url::form_urlencoded;
use url::Url;
use uuid::Uuid;
use webrtc::data_channel::data_channel_state::RTCDataChannelState;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_init::RTCDataChannelInit;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;

const AES_KEY_LEN: usize = 32;
const AES_NONCE_LEN: usize = 12;
const AES_TAG_LEN: usize = 16;
const MAX_FRAME_SIZE: usize = 16 * 1024;

// Design: see README.md and docs/signaling-protocol.md; related to Command and transfer helpers below.
#[derive(Parser, Debug)]
#[command(name = "pairlane")]
#[command(about = "P2P file transfer CLI for Pairlane")]
struct Cli {
  #[command(subcommand)]
  command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
  Send {
    #[arg(value_name = "FILE", help = "File to send")]
    file: Option<PathBuf>,
    #[arg(long = "file", value_name = "PATH", help = "File to send (legacy --file)", hide = true)]
    file_flag: Option<PathBuf>,
    #[arg(value_name = "ROOM_ID_OR_URL", help = "Room ID or full room URL (optional, supports #k=...)")]
    room_input: Option<String>,
    #[arg(long = "room-id", value_name = "ROOM_ID_OR_URL", help = "Room ID or full room URL (legacy --room-id)", hide = true)]
    room_id: Option<String>,
    #[arg(long, value_name = "URL", help = "Override signaling endpoint")]
    endpoint: Option<String>,
    #[arg(long, help = "Disable E2E encryption (default: enabled)")]
    no_encrypt: bool,
    #[arg(long, help = "Keep running after a successful send")]
    stay_open: bool,
  },
  Receive {
    #[arg(value_name = "ROOM_ID_OR_URL", help = "Room ID or full room URL (supports #k=...)")]
    room_input: Option<String>,
    #[arg(long = "room-id", value_name = "ROOM_ID_OR_URL", help = "Room ID or full room URL (legacy --room-id)", hide = true)]
    room_id: Option<String>,
    #[arg(long, default_value = ".", value_name = "DIR", help = "Output directory")]
    output_dir: PathBuf,
    #[arg(long, value_name = "URL", help = "Override signaling endpoint")]
    endpoint: Option<String>,
    #[arg(long, value_name = "KEY", help = "Base64url decryption key (overrides #k=...)")]
    key: Option<String>,
    #[arg(long, help = "Keep running after a successful receive")]
    stay_open: bool,
  },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ServerMessage {
  #[serde(rename = "role")]
  Role { role: String, cid: String },
  #[serde(rename = "peers")]
  Peers { count: u32 },
  #[serde(rename = "wait")]
  Wait { position: Option<u32> },
  #[serde(rename = "start")]
  Start { #[serde(rename = "peerId")] peer_id: Option<String> },
  #[serde(rename = "peer-left")]
  PeerLeft { #[serde(rename = "peerId")] peer_id: String },
  #[serde(rename = "offer")]
  Offer { from: String, sid: u64, sdp: RTCSessionDescription },
  #[serde(rename = "answer")]
  Answer { from: String, sid: u64, sdp: RTCSessionDescription },
  #[serde(rename = "candidate")]
  Candidate { from: String, sid: u64, candidate: RTCIceCandidateInit },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum ClientMessage {
  #[serde(rename = "offer")]
  Offer { to: String, sid: u64, sdp: RTCSessionDescription },
  #[serde(rename = "answer")]
  Answer { to: String, sid: u64, sdp: RTCSessionDescription },
  #[serde(rename = "candidate")]
  Candidate { to: String, sid: u64, candidate: RTCIceCandidateInit },
  #[serde(rename = "transfer-done")]
  TransferDone { #[serde(rename = "peerId")] peer_id: String },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum DataMessage {
  #[serde(rename = "meta")]
  Meta {
    name: String,
    size: u64,
    mime: String,
    encrypted: bool,
  },
  #[serde(rename = "done")]
  Done,
}

struct RoomInput {
  room_id: String,
  endpoint: Option<String>,
  key: Option<Vec<u8>>,
}

#[derive(Clone)]
struct FileInfo {
  path: PathBuf,
  name: String,
  size: u64,
  mime: String,
}

struct OffererPeerState {
  signal_sid: u64,
  active_sid: Option<u64>,
  pending_candidates: Vec<PendingCandidate>,
  remote_desc_set: bool,
  sending: bool,
}

struct PendingCandidate {
  sid: u64,
  candidate: RTCIceCandidateInit,
}

struct OffererPeer {
  peer_id: String,
  pc: Arc<RTCPeerConnection>,
  state: Arc<Mutex<OffererPeerState>>,
}

struct ReceiverState {
  pc: Arc<RTCPeerConnection>,
  peer_id: Option<String>,
  active_sid: Option<u64>,
  pending_candidates: Vec<PendingCandidate>,
  remote_desc_set: bool,
}

struct ReceiveProgress {
  output_dir: PathBuf,
  current_file: Option<PathBuf>,
  file: Option<File>,
  expected_size: u64,
  received: u64,
  encrypted: bool,
  crypto: Option<Arc<Aes256Gcm>>,
  success_tx: Option<mpsc::UnboundedSender<()>>,
}

#[tokio::main]
async fn main() -> Result<()> {
  let cli = Cli::parse();

  match cli.command {
    Command::Send {
      file,
      file_flag,
      room_input,
      room_id,
      endpoint,
      no_encrypt,
      stay_open,
    } => {
      let file = file_flag
        .or(file)
        .ok_or_else(|| anyhow!("File path is required (usage: send <FILE>)"))?;
      let room_input = room_id.or(room_input);
      run_send(room_input.as_deref(), &file, endpoint.as_deref(), no_encrypt, stay_open).await
    }
    Command::Receive {
      room_input,
      room_id,
      output_dir,
      endpoint,
      key,
      stay_open,
    } => {
      let room_input = room_id
        .or(room_input)
        .ok_or_else(|| anyhow!("Room ID or URL is required (usage: receive <ROOM_ID_OR_URL>)"))?;
      run_receive(&room_input, &output_dir, endpoint.as_deref(), key.as_deref(), stay_open).await
    }
  }
}

async fn run_send(
  room_id: Option<&str>,
  file_path: &Path,
  endpoint: Option<&str>,
  no_encrypt: bool,
  stay_open: bool,
) -> Result<()> {
  let file_info = load_file_info(file_path).await?;
  let mut endpoint_override = endpoint.map(|value| value.to_string());
  let mut room_key: Option<Vec<u8>> = None;
  let client_id = Uuid::new_v4().to_string();
  let room_id = match room_id {
    Some(value) => {
      let parsed = parse_room_input(value)?;
      if endpoint_override.is_none() {
        endpoint_override = parsed.endpoint;
      }
      room_key = parsed.key;
      parsed.room_id
    }
    None => create_room(endpoint_override.as_deref(), Some(&client_id)).await?,
  };
  let encrypt = !no_encrypt;
  let room_key = if encrypt {
    Some(match room_key {
      Some(key) => key,
      None => generate_key()?.to_vec(),
    })
  } else {
    None
  };
  let crypto = match room_key.as_deref() {
    Some(key) => Some(Arc::new(build_crypto(key)?)),
    None => None,
  };
  let ws_url = build_ws_url(endpoint_override.as_deref(), &room_id, &client_id)?;

  log_line("[room] id", &room_id);
  log_line(
    "[room] url",
    &build_room_url_with_key(endpoint_override.as_deref(), &room_id, room_key.as_deref())?,
  );
  log_line("[ws] connecting", &ws_url.to_string());
  let (ws_stream, _) = connect_async(ws_url.to_string())
    .await
    .context("connect signaling websocket")?;
  let (mut ws_write, mut ws_read) = ws_stream.split();

  let (signal_tx, mut signal_rx) = mpsc::unbounded_channel::<ClientMessage>();
  let (success_tx, mut success_rx) = mpsc::unbounded_channel::<()>();
  let success_tx = if stay_open { None } else { Some(success_tx) };

  let writer = tokio::spawn(async move {
    while let Some(msg) = signal_rx.recv().await {
      let text = serde_json::to_string(&msg).map_err(|err| anyhow!(err))?;
      ws_write.send(Message::Text(text)).await.map_err(|err| anyhow!(err))?;
    }
    Ok::<(), anyhow::Error>(())
  });

  let peers: Arc<Mutex<HashMap<String, Arc<OffererPeer>>>> = Arc::new(Mutex::new(HashMap::new()));
  let file_info = Arc::new(file_info);

  let mut completed = false;
  loop {
    tokio::select! {
      msg = ws_read.next() => {
        let msg = match msg {
          Some(msg) => msg.context("websocket read")?,
          None => break,
        };
        if let Message::Text(text) = msg {
          let parsed: ServerMessage = match serde_json::from_str(&text) {
            Ok(msg) => msg,
            Err(_) => continue,
          };

          match parsed {
            ServerMessage::Role { role, cid } => {
              log_line("[ws] role", &format!("{role} ({cid})"));
              if role != "offerer" {
                return Err(anyhow!("This command must be the offerer; connect first or use receive."));
              }
            }
            ServerMessage::Peers { count } => {
              log_line("[ws] peers", &count.to_string());
            }
            ServerMessage::Wait { position } => {
              let label = position.map(|p| p.to_string()).unwrap_or_else(|| "waiting".to_string());
              log_line("[ws] queue", &label);
            }
            ServerMessage::Start { peer_id } => {
              if let Some(peer_id) = peer_id {
                let peer = create_offerer_peer(
                  peer_id.clone(),
                  signal_tx.clone(),
                  file_info.clone(),
                  crypto.clone(),
                  success_tx.clone(),
                )
                .await?;
                peers.lock().await.insert(peer_id.clone(), peer);
              }
            }
            ServerMessage::Answer { from, sid, sdp } => {
              if let Some(peer) = peers.lock().await.get(&from).cloned() {
                handle_answer(peer, sid, sdp).await?;
              }
            }
            ServerMessage::Candidate { from, sid, candidate } => {
              if let Some(peer) = peers.lock().await.get(&from).cloned() {
                handle_offer_candidate(peer, sid, candidate).await?;
              }
            }
            ServerMessage::PeerLeft { peer_id } => {
              log_line("[ws] peer-left", &peer_id);
              peers.lock().await.remove(&peer_id);
            }
            _ => {}
          }
        }
      }
      _ = success_rx.recv(), if !stay_open => {
        log_line("[send] completed", "transfer done");
        let peers_snapshot = {
          let guard = peers.lock().await;
          guard.values().cloned().collect::<Vec<_>>()
        };
        for peer in peers_snapshot {
          let _ = peer.pc.close().await;
        }
        completed = true;
        break;
      }
    }
  }
  if completed {
    writer.abort();
    return Ok(());
  }
  drop(signal_tx);
  writer.await??;
  Ok(())
}

async fn run_receive(
  room_input: &str,
  output_dir: &Path,
  endpoint: Option<&str>,
  key: Option<&str>,
  stay_open: bool,
) -> Result<()> {
  let parsed = parse_room_input(room_input)?;
  let mut key_override = parsed.key;
  if let Some(key) = key {
    key_override = Some(b64url_decode(key)?);
  }
  let endpoint_override = endpoint.or(parsed.endpoint.as_deref());
  let crypto = match key_override.as_deref() {
    Some(key) => Some(Arc::new(build_crypto(key)?)),
    None => None,
  };
  let room_id = parsed.room_id;
  let client_id = Uuid::new_v4().to_string();
  let ws_url = build_ws_url(endpoint_override, &room_id, &client_id)?;

  log_line("[room] id", &room_id);
  log_line("[ws] connecting", &ws_url.to_string());
  let (ws_stream, _) = connect_async(ws_url.to_string())
    .await
    .context("connect signaling websocket")?;
  let (mut ws_write, mut ws_read) = ws_stream.split();

  let (signal_tx, mut signal_rx) = mpsc::unbounded_channel::<ClientMessage>();
  let (success_tx, mut success_rx) = mpsc::unbounded_channel::<()>();
  let success_tx = if stay_open { None } else { Some(success_tx) };

  let writer = tokio::spawn(async move {
    while let Some(msg) = signal_rx.recv().await {
      let text = serde_json::to_string(&msg).map_err(|err| anyhow!(err))?;
      ws_write.send(Message::Text(text)).await.map_err(|err| anyhow!(err))?;
    }
    Ok::<(), anyhow::Error>(())
  });

  let receiver_state: Arc<Mutex<Option<ReceiverState>>> = Arc::new(Mutex::new(None));
  let progress = Arc::new(Mutex::new(ReceiveProgress {
    output_dir: output_dir.to_path_buf(),
    current_file: None,
    file: None,
    expected_size: 0,
    received: 0,
    encrypted: false,
    crypto,
    success_tx,
  }));

  let mut completed = false;
  loop {
    tokio::select! {
      msg = ws_read.next() => {
        let msg = match msg {
          Some(msg) => msg.context("websocket read")?,
          None => break,
        };
        if let Message::Text(text) = msg {
          let parsed: ServerMessage = match serde_json::from_str(&text) {
            Ok(msg) => msg,
            Err(_) => continue,
          };

          match parsed {
            ServerMessage::Role { role, cid } => {
              log_line("[ws] role", &format!("{role} ({cid})"));
              if role != "answerer" {
                return Err(anyhow!("This command must be the answerer; connect after the sender."));
              }
            }
            ServerMessage::Peers { count } => {
              log_line("[ws] peers", &count.to_string());
            }
            ServerMessage::Wait { position } => {
              let label = position.map(|p| p.to_string()).unwrap_or_else(|| "waiting".to_string());
              log_line("[ws] queue", &label);
            }
            ServerMessage::Start { .. } => {
              let pc = create_peer_connection().await?;
              let tx = signal_tx.clone();
              let receiver_state_for_ice = receiver_state.clone();
              pc.on_ice_candidate(Box::new(move |candidate| {
                let tx = tx.clone();
                let receiver_state = receiver_state_for_ice.clone();
                Box::pin(async move {
                  if let Some(candidate) = candidate {
                    let candidate = candidate.to_json().unwrap_or_default();
                    let guard = receiver_state.lock().await;
                    if let Some(state) = guard.as_ref() {
                      if let (Some(peer_id), Some(sid)) = (state.peer_id.clone(), state.active_sid) {
                        let _ = tx.send(ClientMessage::Candidate { to: peer_id, sid, candidate });
                      }
                    }
                  }
                })
              }));

              let rx_progress = progress.clone();
              pc.on_data_channel(Box::new(move |dc| {
                let rx_progress = rx_progress.clone();
                Box::pin(async move {
                  wire_receiver_channel(dc, rx_progress).await;
                })
              }));

              *receiver_state.lock().await = Some(ReceiverState {
                pc,
                peer_id: None,
                active_sid: None,
                pending_candidates: Vec::new(),
                remote_desc_set: false,
              });
            }
            ServerMessage::Offer { from, sid, sdp } => {
              let mut guard = receiver_state.lock().await;
              let state = guard.as_mut().ok_or_else(|| anyhow!("Receiver not initialized"))?;
              state.peer_id = Some(from.clone());
              state.active_sid = Some(sid);
              state.pc.set_remote_description(sdp).await?;
              state.remote_desc_set = true;
              flush_receiver_candidates(state).await?;

              let answer = state.pc.create_answer(None).await?;
              state.pc.set_local_description(answer).await?;
              if let Some(local) = state.pc.local_description().await {
                let _ = signal_tx.send(ClientMessage::Answer { to: from, sid, sdp: local });
              }
            }
            ServerMessage::Candidate { from: _, sid, candidate } => {
              let mut guard = receiver_state.lock().await;
              if let Some(state) = guard.as_mut() {
                handle_receiver_candidate(state, sid, candidate).await?;
              }
            }
            _ => {}
          }
        }
      }
      _ = success_rx.recv(), if !stay_open => {
        log_line("[recv] completed", "transfer done");
        if let Some(state) = receiver_state.lock().await.take() {
          let _ = state.pc.close().await;
        }
        completed = true;
        break;
      }
    }
  }
  if completed {
    writer.abort();
    return Ok(());
  }
  drop(signal_tx);
  writer.await??;
  Ok(())
}

async fn create_offerer_peer(
  peer_id: String,
  signal_tx: mpsc::UnboundedSender<ClientMessage>,
  file_info: Arc<FileInfo>,
  crypto: Option<Arc<Aes256Gcm>>,
  success_tx: Option<mpsc::UnboundedSender<()>>,
) -> Result<Arc<OffererPeer>> {
  let pc = create_peer_connection().await?;
  let dc = pc
    .create_data_channel(
      "file",
      Some(RTCDataChannelInit {
        ordered: Some(true),
        ..Default::default()
      }),
    )
    .await?;

  let peer = Arc::new(OffererPeer {
    peer_id: peer_id.clone(),
    pc: pc.clone(),
    state: Arc::new(Mutex::new(OffererPeerState {
      signal_sid: 0,
      active_sid: None,
      pending_candidates: Vec::new(),
      remote_desc_set: false,
      sending: false,
    })),
  });

  let peer_clone = peer.clone();
  let tx = signal_tx.clone();
  pc.on_ice_candidate(Box::new(move |candidate| {
    let peer_clone = peer_clone.clone();
    let tx = tx.clone();
    Box::pin(async move {
      if let Some(candidate) = candidate {
        let candidate = candidate.to_json().unwrap_or_default();
        let sid = peer_clone.state.lock().await.active_sid;
        if let Some(sid) = sid {
          let _ = tx.send(ClientMessage::Candidate {
            to: peer_clone.peer_id.clone(),
            sid,
            candidate,
          });
        }
      }
    })
  }));

  pc.on_peer_connection_state_change(Box::new(move |state: RTCPeerConnectionState| {
    Box::pin(async move {
      log_line("[rtc] connectionState", &format!("{:?}", state));
    })
  }));

  let send_tx = signal_tx.clone();
  let send_peer_id = peer_id.clone();
  let file_info = file_info.clone();
  let send_state = peer.state.clone();
  let dc_for_open = dc.clone();
  let crypto = crypto.clone();
  let success_tx = success_tx.clone();
  dc.on_open(Box::new(move || {
    let send_tx = send_tx.clone();
    let send_peer_id = send_peer_id.clone();
    let file_info = file_info.clone();
    let dc = dc_for_open.clone();
    let send_state = send_state.clone();
    let crypto = crypto.clone();
    let success_tx = success_tx.clone();
    Box::pin(async move {
      let mut guard = send_state.lock().await;
      if guard.sending {
        return;
      }
      guard.sending = true;
      drop(guard);

      if let Err(err) = send_file(&dc, &file_info, crypto).await {
        log_line("[send] error", &format!("{err:#}"));
        return;
      }
      let _ = send_tx.send(ClientMessage::TransferDone { peer_id: send_peer_id });
      if let Some(tx) = success_tx.as_ref() {
        let _ = tx.send(());
      }
    })
  }));

  send_offer(peer.clone(), signal_tx).await?;

  Ok(peer)
}

async fn send_offer(peer: Arc<OffererPeer>, signal_tx: mpsc::UnboundedSender<ClientMessage>) -> Result<()> {
  let mut guard = peer.state.lock().await;
  if guard.active_sid.is_some() {
    return Ok(());
  }
  guard.signal_sid += 1;
  let sid = guard.signal_sid;
  guard.active_sid = Some(sid);
  drop(guard);

  let offer = peer.pc.create_offer(None).await?;
  peer.pc.set_local_description(offer).await?;
  if let Some(local) = peer.pc.local_description().await {
    let _ = signal_tx.send(ClientMessage::Offer {
      to: peer.peer_id.clone(),
      sid,
      sdp: local,
    });
  }
  Ok(())
}

async fn handle_answer(peer: Arc<OffererPeer>, sid: u64, sdp: RTCSessionDescription) -> Result<()> {
  let mut guard = peer.state.lock().await;
  if guard.active_sid != Some(sid) {
    return Ok(());
  }
  peer.pc.set_remote_description(sdp).await?;
  guard.remote_desc_set = true;
  drop(guard);
  flush_offer_candidates(peer).await?;
  Ok(())
}

async fn handle_offer_candidate(peer: Arc<OffererPeer>, sid: u64, candidate: RTCIceCandidateInit) -> Result<()> {
  let mut guard = peer.state.lock().await;
  if guard.remote_desc_set {
    drop(guard);
    peer.pc.add_ice_candidate(candidate).await?;
  } else {
    guard.pending_candidates.push(PendingCandidate { sid, candidate });
  }
  Ok(())
}

async fn flush_offer_candidates(peer: Arc<OffererPeer>) -> Result<()> {
  let sid = peer.state.lock().await.active_sid;
  if sid.is_none() {
    return Ok(());
  }
  let sid = sid.unwrap();
  let pending = {
    let mut guard = peer.state.lock().await;
    std::mem::take(&mut guard.pending_candidates)
  };
  let mut remaining = Vec::new();
  for item in pending {
    if item.sid == sid {
      peer.pc.add_ice_candidate(item.candidate).await?;
    } else {
      remaining.push(item);
    }
  }
  peer.state.lock().await.pending_candidates.extend(remaining);
  Ok(())
}

async fn handle_receiver_candidate(state: &mut ReceiverState, sid: u64, candidate: RTCIceCandidateInit) -> Result<()> {
  if state.remote_desc_set {
    state.pc.add_ice_candidate(candidate).await?;
  } else {
    state.pending_candidates.push(PendingCandidate { sid, candidate });
  }
  Ok(())
}

async fn flush_receiver_candidates(state: &mut ReceiverState) -> Result<()> {
  let sid = state.active_sid;
  if sid.is_none() {
    return Ok(());
  }
  let sid = sid.unwrap();
  let pending = std::mem::take(&mut state.pending_candidates);
  let mut remaining = Vec::new();
  for item in pending {
    if item.sid == sid {
      state.pc.add_ice_candidate(item.candidate).await?;
    } else {
      remaining.push(item);
    }
  }
  state.pending_candidates = remaining;
  Ok(())
}

async fn wire_receiver_channel(dc: Arc<RTCDataChannel>, progress: Arc<Mutex<ReceiveProgress>>) {
  dc.on_message(Box::new(move |msg: DataChannelMessage| {
    let progress = progress.clone();
    Box::pin(async move {
      if msg.is_string {
        if let Ok(text) = String::from_utf8(msg.data.to_vec()) {
          if let Ok(parsed) = serde_json::from_str::<DataMessage>(&text) {
            match parsed {
              DataMessage::Meta { name, size, mime, encrypted } => {
                let mut guard = progress.lock().await;
                if encrypted && guard.crypto.is_none() {
                  log_line("[recv] error", "encrypted files need a decryption key");
                  return;
                }
                guard.encrypted = encrypted;
                let safe_name = sanitize_file_name(&name);
                let path = guard.output_dir.join(&safe_name);
                match File::create(&path).await {
                  Ok(file) => {
                    guard.current_file = Some(path);
                    guard.file = Some(file);
                    guard.expected_size = size;
                    guard.received = 0;
                    log_line("[recv] meta", &format!("{safe_name} ({mime}, {size} bytes)"));
                  }
                  Err(err) => {
                    log_line("[recv] error", &format!("{err:#}"));
                  }
                }
              }
              DataMessage::Done => {
                let mut guard = progress.lock().await;
                guard.file = None;
                guard.encrypted = false;
                if let Some(tx) = guard.success_tx.take() {
                  let _ = tx.send(());
                }
                if let Some(path) = guard.current_file.take() {
                  log_line("[recv] completed", &path.display().to_string());
                }
              }
            }
          }
        }
        return;
      }

      let (encrypted, crypto) = {
        let guard = progress.lock().await;
        (guard.encrypted, guard.crypto.clone())
      };

      let payload = if encrypted {
        let crypto = match crypto.as_ref() {
          Some(crypto) => crypto,
          None => {
            log_line("[recv] error", "encrypted chunk received without key");
            return;
          }
        };
        match decrypt_frame(crypto, msg.data.as_ref()) {
          Ok(plain) => plain,
          Err(err) => {
            log_line("[recv] error", &format!("{err:#}"));
            return;
          }
        }
      } else {
        msg.data.to_vec()
      };

      let mut guard = progress.lock().await;
      if let Some(file) = guard.file.as_mut() {
        if file.write_all(&payload).await.is_ok() {
          guard.received += payload.len() as u64;
          if guard.expected_size > 0 && guard.received >= guard.expected_size {
            guard.file = None;
            guard.encrypted = false;
            if let Some(tx) = guard.success_tx.take() {
              let _ = tx.send(());
            }
            if let Some(path) = guard.current_file.take() {
              log_line("[recv] completed", &path.display().to_string());
            }
          }
        }
      }
    })
  }));
}

async fn send_file(dc: &RTCDataChannel, info: &FileInfo, crypto: Option<Arc<Aes256Gcm>>) -> Result<()> {
  let encrypted = crypto.is_some();
  let meta = serde_json::json!({
    "type": "meta",
    "name": info.name,
    "size": info.size,
    "mime": info.mime,
    "encrypted": encrypted,
  });
  let meta_text = serde_json::to_string(&meta)?;
  dc.send_text(meta_text).await?;

  let chunk_size = if encrypted {
    MAX_FRAME_SIZE - AES_NONCE_LEN - AES_TAG_LEN
  } else {
    MAX_FRAME_SIZE
  };
  let mut file = File::open(&info.path).await?;
  let mut buffer = vec![0u8; chunk_size];
  loop {
    let read = file.read(&mut buffer).await?;
    if read == 0 {
      break;
    }
    let payload = if let Some(crypto) = crypto.as_ref() {
      Bytes::from(encrypt_frame(crypto, &buffer[..read])?)
    } else {
      Bytes::copy_from_slice(&buffer[..read])
    };
    dc.send(&payload).await?;
  }

  dc.send_text("{\"type\":\"done\"}").await?;
  wait_for_drain(dc).await;
  Ok(())
}

async fn load_file_info(path: &Path) -> Result<FileInfo> {
  let metadata = tokio::fs::metadata(path).await?;
  let size = metadata.len();
  let name = path
    .file_name()
    .and_then(|n| n.to_str())
    .ok_or_else(|| anyhow!("Invalid file name"))?
    .to_string();
  let mime = mime_guess::from_path(path)
    .first_or_octet_stream()
    .essence_str()
    .to_string();
  Ok(FileInfo {
    path: path.to_path_buf(),
    name,
    size,
    mime,
  })
}

async fn create_peer_connection() -> Result<Arc<RTCPeerConnection>> {
  let mut media_engine = MediaEngine::default();
  media_engine.register_default_codecs()?;

  let mut registry = Registry::new();
  registry = register_default_interceptors(registry, &mut media_engine)?;

  let api = APIBuilder::new()
    .with_media_engine(media_engine)
    .with_interceptor_registry(registry)
    .build();

  let config = RTCConfiguration {
    ice_servers: vec![RTCIceServer {
      urls: vec!["stun:stun.cloudflare.com:3478".to_string()],
      ..Default::default()
    }],
    ..Default::default()
  };

  let pc = api.new_peer_connection(config).await?;
  Ok(Arc::new(pc))
}

fn parse_room_input(value: &str) -> Result<RoomInput> {
  if let Ok(url) = Url::parse(value) {
    return parse_room_url(&url);
  }
  let mut room_id = value;
  let mut key = None;
  if let Some((id, fragment)) = value.split_once('#') {
    room_id = id;
    key = parse_key_fragment(fragment)?;
  }
  let room_id = room_id.trim();
  if room_id.is_empty() {
    return Err(anyhow!("Room ID is required"));
  }
  Ok(RoomInput {
    room_id: room_id.to_string(),
    endpoint: None,
    key,
  })
}

fn parse_room_url(url: &Url) -> Result<RoomInput> {
  let room_id = extract_room_id_from_url(url)?;
  let endpoint = Some(base_endpoint_url(Some(url.as_str()))?.to_string());
  let key = match url.fragment() {
    Some(fragment) => parse_key_fragment(fragment)?,
    None => None,
  };
  Ok(RoomInput { room_id, endpoint, key })
}

fn extract_room_id_from_url(url: &Url) -> Result<String> {
  let segments: Vec<_> = url
    .path_segments()
    .map(|segments| segments.filter(|segment| !segment.is_empty()).collect())
    .unwrap_or_default();
  match segments.as_slice() {
    ["r", room_id, ..] => Ok(room_id.to_string()),
    [room_id] => Ok(room_id.to_string()),
    _ => Err(anyhow!("Room ID not found in URL path")),
  }
}

fn parse_key_fragment(fragment: &str) -> Result<Option<Vec<u8>>> {
  for (key, value) in form_urlencoded::parse(fragment.as_bytes()) {
    if key == "k" {
      return Ok(Some(b64url_decode(&value)?));
    }
  }
  Ok(None)
}

fn build_crypto(key: &[u8]) -> Result<Aes256Gcm> {
  Aes256Gcm::new_from_slice(key).map_err(|_| anyhow!("Invalid encryption key length"))
}

fn generate_key() -> Result<[u8; AES_KEY_LEN]> {
  let mut key = [0u8; AES_KEY_LEN];
  getrandom(&mut key).map_err(|err| anyhow!(err))?;
  Ok(key)
}

fn encrypt_frame(crypto: &Aes256Gcm, plain: &[u8]) -> Result<Vec<u8>> {
  let mut nonce_bytes = [0u8; AES_NONCE_LEN];
  getrandom(&mut nonce_bytes).map_err(|err| anyhow!(err))?;
  let nonce = Nonce::from_slice(&nonce_bytes);
  let ciphertext = crypto.encrypt(nonce, plain).map_err(|err| anyhow!(err))?;
  let mut frame = Vec::with_capacity(AES_NONCE_LEN + ciphertext.len());
  frame.extend_from_slice(&nonce_bytes);
  frame.extend_from_slice(&ciphertext);
  Ok(frame)
}

fn decrypt_frame(crypto: &Aes256Gcm, frame: &[u8]) -> Result<Vec<u8>> {
  if frame.len() < AES_NONCE_LEN {
    return Err(anyhow!("Encrypted frame is too short"));
  }
  let (nonce_bytes, ciphertext) = frame.split_at(AES_NONCE_LEN);
  let nonce = Nonce::from_slice(nonce_bytes);
  crypto.decrypt(nonce, ciphertext).map_err(|err| anyhow!(err))
}

fn b64url_encode(value: &[u8]) -> String {
  URL_SAFE_NO_PAD.encode(value)
}

fn b64url_decode(value: &str) -> Result<Vec<u8>> {
  URL_SAFE_NO_PAD.decode(value).map_err(|err| anyhow!(err))
}

fn sanitize_file_name(name: &str) -> String {
  let candidate = Path::new(name)
    .file_name()
    .and_then(|n| n.to_str())
    .unwrap_or("file");
  let trimmed = candidate.trim();
  if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
    "file".to_string()
  } else {
    trimmed.to_string()
  }
}

async fn wait_for_drain(dc: &RTCDataChannel) {
  for _ in 0..500 {
    if dc.ready_state() != RTCDataChannelState::Open {
      break;
    }
    if dc.buffered_amount().await == 0 {
      break;
    }
    sleep(Duration::from_millis(10)).await;
  }
}

fn build_ws_url(endpoint: Option<&str>, room_id: &str, client_id: &str) -> Result<Url> {
  let mut url = base_endpoint_url(endpoint)?;
  let scheme = match url.scheme() {
    "https" => "wss",
    "http" => "ws",
    "wss" => "wss",
    "ws" => "ws",
    other => return Err(anyhow!("Unsupported endpoint scheme: {other}")),
  };
  url.set_scheme(scheme).map_err(|_| anyhow!("Invalid endpoint scheme"))?;
  url.set_path(&format!("/ws/{room_id}"));
  url.set_query(Some(&format!("cid={client_id}")));
  Ok(url)
}

fn build_room_url_with_key(endpoint: Option<&str>, room_id: &str, key: Option<&[u8]>) -> Result<String> {
  let mut url = base_endpoint_url(endpoint)?;
  url.set_path(&format!("/r/{room_id}"));
  url.set_query(None);
  if let Some(key) = key {
    url.set_fragment(Some(&format!("k={}", b64url_encode(key))));
  } else {
    url.set_fragment(None);
  }
  Ok(url.to_string())
}

fn base_endpoint_url(endpoint: Option<&str>) -> Result<Url> {
  let default_endpoint = "https://getpairlane.com";
  let env_endpoint = env::var("PAIRLANE_ENDPOINT")
    .ok()
    .or_else(|| env::var("SHARE_FILES_ENDPOINT").ok());
  let endpoint = endpoint
    .map(|value| value.to_string())
    .or(env_endpoint)
    .unwrap_or_else(|| default_endpoint.to_string());

  let mut url = Url::parse(&endpoint)?;
  let scheme = match url.scheme() {
    "https" | "http" => url.scheme().to_string(),
    "wss" => "https".to_string(),
    "ws" => "http".to_string(),
    other => return Err(anyhow!("Unsupported endpoint scheme: {other}")),
  };
  url.set_scheme(&scheme).map_err(|_| anyhow!("Invalid endpoint scheme"))?;
  url.set_path("");
  url.set_query(None);
  url.set_fragment(None);
  Ok(url)
}

async fn create_room(endpoint: Option<&str>, creator_cid: Option<&str>) -> Result<String> {
  #[derive(Serialize)]
  struct RoomRequest {
    #[serde(rename = "creatorCid", skip_serializing_if = "Option::is_none")]
    creator_cid: Option<String>,
  }

  #[derive(Deserialize)]
  struct RoomResponse {
    #[serde(rename = "roomId")]
    room_id: String,
  }

  let mut url = base_endpoint_url(endpoint)?;
  url.set_path("/api/rooms");
  let client = reqwest::Client::new();
  let response = client
    .post(url)
    .json(&RoomRequest {
      creator_cid: creator_cid.map(|value| value.to_string()),
    })
    .send()
    .await
    .context("create room request")?;
  let response = response.error_for_status().context("create room response")?;
  let body: RoomResponse = response.json().await.context("parse room response")?;
  Ok(body.room_id)
}

fn log_line(label: &str, value: &str) {
  let now = chrono::Utc::now().format("%H:%M:%S%.3f");
  println!("[{now}] {label}: {value}");
}
