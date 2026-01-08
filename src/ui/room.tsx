/**
 * Room page UI for share-files.
 * See README.md for the flow; pairs with the Room Durable Object and room script.
 */

import { Script } from "vite-ssr-components/hono";
import { Layout } from "./layout";

type RoomPageProps = {
  roomId: string;
};

export function RoomPage({ roomId }: RoomPageProps) {
  return (
    <Layout
      title="SHARE-FILES"
      scripts={<Script src="/src/client/room.tsx" />}
      bodyAttrs={{ "data-room-id": roomId }}
    >
      <section id="roomView" class="card room">
        <div class="roomHeader">
          <div class="roomTitle">
            <div class="eyebrow">ROOM—SESSION</div>
            <h2>ROOM <span id="roomIdLabel" class="mono">{roomId}</span></h2>
            <div id="status" class="status">初期化中...</div>
          </div>
          <div class="right">
            <button id="copyLinkBtn" class="btn">LINK</button>
            <button id="copyCodeBtn" class="btn">CODE</button>
          </div>
        </div>

        <div class="roomGrid">
          <div class="roomSide">
            <div class="kv">
              <div class="k">ROLE</div>
              <div class="v" id="roleLabel">—</div>
              <div class="k">PEERS</div>
              <div class="v" id="peersLabel">0</div>
            </div>
            <div class="sideCard muted small">
              暗号化ONの場合、リンクの「#」以降に復号鍵が含まれます（サーバには送られません）。
            </div>
          </div>

          <div class="roomMain">
            <div id="senderPane" class="pane hidden">
              <div id="drop" class="drop">
                <div class="dropTitle">DROP FILE HERE</div>
                <div class="muted small">または</div>
                <label class="btn">
                  SELECT
                  <input id="fileInput" type="file" hidden />
                </label>
              </div>

              <div class="row gap wrap">
                <button id="sendBtn" class="btn primary" disabled>SEND</button>
                <div class="muted small" id="fileInfo"></div>
              </div>

              <div class="progress">
                <div class="bar"><div id="sendBar" class="fill" style="width: 0%"></div></div>
                <div class="muted small" id="sendText">0%</div>
              </div>
            </div>

            <div id="receiverPane" class="pane hidden">
              <div class="muted">送信側がファイルを選ぶのを待っています...</div>

              <div class="progress">
                <div class="bar"><div id="recvBar" class="fill" style="width: 0%"></div></div>
                <div class="muted small" id="recvText">0%</div>
              </div>

              <div id="downloadArea" class="hidden">
                <a id="downloadLink" class="btn primary" href="#">DOWNLOAD</a>
                <div class="muted small" id="downloadMeta"></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
