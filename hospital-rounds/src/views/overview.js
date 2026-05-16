"use strict";

import { appState } from "../store.js";
import { buildTabPayload } from "../payload.js";

export function renderOverviewScreen() {
  const overviewTable = document.getElementById("overviewTable");
  if (!overviewTable) return;
  overviewTable.textContent = "";

  const thead = document.createElement("thead");
  const thr = document.createElement("tr");
  ["患者", "メモ", "QR生成テキスト"].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    thr.appendChild(th);
  });
  thead.appendChild(thr);

  const tbody = document.createElement("tbody");
  for (let i = 1; i <= appState.patients.length; i++) {
    const p = appState.patients[i - 1];
    const tr = document.createElement("tr");

    const noCell = document.createElement("td");
    noCell.className = "ovNum";
    noCell.textContent = p?.name ? p.name : String(i);

    const memoCell = document.createElement("td");
    memoCell.className = "ovMemo";
    memoCell.textContent = String(appState.patients[i - 1]?.memo ?? "").trim();

    const qrCell = document.createElement("td");
    qrCell.className = "ovQr";
    try {
      qrCell.textContent = buildTabPayload(i);
    } catch (e) {
      qrCell.textContent = "(生成エラー)";
    }

    tr.appendChild(noCell);
    tr.appendChild(memoCell);
    tr.appendChild(qrCell);
    tbody.appendChild(tr);
  }
  overviewTable.appendChild(thead);
  overviewTable.appendChild(tbody);
}
