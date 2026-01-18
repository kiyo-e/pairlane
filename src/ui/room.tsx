/**
 * Room page UI for Pairlane.
 * See README.md for the flow; pairs with the Room Durable Object and room script.
 */

import { Script } from "vite-ssr-components/hono";
import { Layout } from "./layout";
import type { Translations, Locale } from "../i18n";

type RoomPageProps = {
  roomId: string;
  maxConcurrent: number;
  t: Translations;
  locale: Locale;
  url?: string;
};

export function RoomPage({ roomId, maxConcurrent, t, locale, url }: RoomPageProps) {
  const maxConcurrentLabel = t.room.maxConcurrentLimit.replace("{max}", String(maxConcurrent));
  const initialStepLabel = t.guide.stepLabel.replace("{current}", "1").replace("{total}", "4");
  return (
    <Layout
      title={t.title}
      scripts={<Script src="/src/client/room.tsx" />}
      bodyAttrs={{ "data-room-id": roomId, "data-max-concurrent": String(maxConcurrent) }}
      t={t}
      locale={locale}
      url={url}
    >
      <section id="roomView" class="card room">
        <div class="roomHeader">
          <div class="roomTitle">
            <div class="eyebrow">{t.room.eyebrow}</div>
            <h2>{t.room.roomLabel} <span id="roomIdLabel" class="mono">{roomId}</span></h2>
            <div id="status" class="status">{t.status.initializing}</div>
          </div>
          <div class="right">
            <button id="copyLinkBtn" class="btn" title={t.room.copyLinkHint}>{t.room.copyLink}</button>
            <button id="copyCodeBtn" class="btn" title={t.room.copyCodeHint}>{t.room.copyCode}</button>
          </div>
        </div>

        <div class="roomGrid">
          <div class="roomSide">
            <div class="kv">
              <div class="k">{t.room.roleLabel}</div>
              <div class="v" id="roleLabel">{t.role.unknown}</div>
              <div class="k">{t.room.peersLabel}</div>
              <div class="v" id="peersLabel">0{t.room.peersUnit}</div>
            </div>
            <div class="sideCard muted small">{t.room.encryptHint}</div>
            <div class="sideCard muted small">{maxConcurrentLabel}</div>
          </div>

          <div class="roomMain">
            <div class="stepGuide waiting">
              <div class="stepProgress">
                <div class="stepDot current"></div>
                <div class="stepDot"></div>
                <div class="stepDot"></div>
                <div class="stepDot"></div>
              </div>
              <div class="stepLabel">{initialStepLabel}</div>
              <div class="stepMain">{t.guide.receiverConnecting}</div>
              <div class="stepSub">{t.guide.receiverConnectingSub}</div>
            </div>

            <div id="senderPane" class="pane hidden">
              <div id="drop" class="drop">
                <div class="dropTitle">{t.room.dropTitle}</div>
                <div class="muted small">{t.room.dropOr}</div>
                <label class="btn">
                  {t.room.select}
                  <input id="fileInput" type="file" hidden />
                </label>
              </div>

              <div class="row gap wrap">
                <button id="sendBtn" class="btn primary" disabled>{t.room.send}</button>
                <div class="muted small" id="fileInfo"></div>
              </div>

              <div class="progress">
                <div class="bar"><div id="sendBar" class="fill" style="width: 0%"></div></div>
                <div class="muted small" id="sendText">0%</div>
              </div>
            </div>

            <div id="receiverPane" class="pane hidden">
              <div class="muted">{t.room.waiting}</div>

              <div class="progress">
                <div class="bar"><div id="recvBar" class="fill" style="width: 0%"></div></div>
                <div class="muted small" id="recvText">0%</div>
              </div>

              <div id="downloadArea" class="hidden">
                <a id="downloadLink" class="btn primary" href="#">{t.room.download}</a>
                <div class="muted small" id="downloadMeta"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="foot muted">
          {t.home.footer} · <a href={t.home.githubUrl} target="_blank" rel="noopener noreferrer">{t.home.githubText}</a>
        </div>

      </section>
    </Layout>
  );
}
