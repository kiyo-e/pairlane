/**
 * Top page UI for Pairlane.
 * See README.md for the user flow; pairs with RoomPage and the home script.
 */

import { Script } from "vite-ssr-components/hono";
import { Layout } from "./layout";
import type { Translations, Locale } from "../i18n";

type TopPageProps = {
  t: Translations;
  locale: Locale;
};

export function TopPage({ t, locale }: TopPageProps) {
  return (
    <Layout
      title={t.title}
      scripts={<Script src="/src/client/home.tsx" />}
      t={t}
      locale={locale}
    >
      <section id="homeView" class="card home">
        <div class="homeGrid">
          <div class="homeHero">
            <div class="eyebrow">{t.home.eyebrow}</div>
            <h1 dangerouslySetInnerHTML={{ __html: t.home.heroTitle }} />
            <p class="lead">{t.home.heroLead}</p>
            <div class="heroChips">
              <span class="chip">NO SERVER STORAGE</span>
              <span class="chip">1:N P2P</span>
              <span class="chip">WEBRTC</span>
            </div>
            <div class="steps">
              <div class="step"><span>1</span> {t.home.step1}</div>
              <div class="step"><span>2</span> {t.home.step2}</div>
              <div class="step"><span>3</span> {t.home.step3}</div>
            </div>
          </div>

          <div class="homePanel">
            <div class="panelBlock">
              <div class="panelTitle">{t.home.sendTitle}</div>
            <label class="toggle">
              <input id="encryptToggle" type="checkbox" checked />
              <span>{t.home.encryptOn}</span>
            </label>
            <label class="row gap">
              <span class="muted small">{t.home.maxConcurrent}</span>
              <input id="maxConcurrent" class="input" type="number" min="1" max="10" value="3" />
            </label>
            <button id="createBtn" class="btn primary">{t.home.createRoom}</button>
          </div>

            <hr class="sep" />

            <div class="panelBlock">
              <div class="panelTitle">{t.home.receiveTitle}</div>
              <div class="row gap wrap">
                <input id="joinCode" class="input" placeholder={t.home.codePlaceholder} />
                <button id="joinBtn" class="btn">{t.home.join}</button>
              </div>
              <p class="muted small">{t.home.encryptHint}</p>
            </div>
          </div>
        </div>

        <div class="foot muted">{t.home.footer}</div>
      </section>
    </Layout>
  );
}
