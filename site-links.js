/* ============================================================================
 * site-links.js — サイト横断リンクの「単一ソース」(正本)
 *
 * ★このファイルが正本 (master)。snishi-code.com (apex) リポで管理する。
 *   medical / personal リポにも同一内容のコピーを置く (別 origin のファイルは
 *   ブラウザが共有できないため物理的にコピーが必要)。URL を変えるときは
 *   まずこの正本を直し、各リポのコピーへ反映する。
 *
 * Origin 分離後、カテゴリ間 (apex ↔ medical ↔ personal) のリンクはサブドメインを
 * またぐ絶対 URL になる。これを各 HTML に直書きすると変更時に追い切れないため、
 * URL はこのファイル 1 箇所だけで管理する。
 *
 * 使い方: HTML 側は href を書かず data-link 属性で参照する。
 *   <a class="nav-link" data-link="medical">医療</a>
 *   <script src="/site-links.js"></script>   ← </body> 直前で読み込む
 * 読み込み時に data-link を持つ全要素へ href を流し込む。
 *
 * ※ apex から個別アプリへ直接案内するリンクはここに置く。
 *   medical 側にも同名ルートを作るまで、URL の正本として扱う。
 * ========================================================================== */
window.SITE_LINKS = {
  apex:        "https://snishi-code.com",
  medical:     "https://medical.snishi-code.com",
  medicalDev:  "https://medical-dev.snishi-code.com",
  medicalWorkspace: "https://medical.snishi-code.com/hospital-workspace/",
  medicalWorkspaceAbout: "https://medical.snishi-code.com/about/hospital-workspace/",
  medicalRoundsAbout: "https://medical.snishi-code.com/about/hospital-rounds/",
  medicalNoteAssistAbout: "https://medical.snishi-code.com/about/hospital-note-assist/",
  personal:    "https://personal.snishi-code.com",
  personalDev: "https://personal-dev.snishi-code.com",
  github:      "https://github.com/snishi-code",
};

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-link]").forEach((el) => {
    const url = window.SITE_LINKS[el.dataset.link];
    if (url) el.setAttribute("href", url);
  });
});
