import type { ResultRow } from "./types";

function csvEscape(value: string): string {
  const v = value ?? "";
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/** Build the 2-column CSV (Name, Date) preserving queue order. Failed rows
 * keep their place with the explanation written into the row instead of
 * being skipped. */
export function buildCsv(rows: ResultRow[]): string {
  const header = ["NAME", "DATE"];
  const lines = [header.join(",")];

  for (const row of rows) {
    if (row.status === "done") {
      lines.push([csvEscape(row.name), csvEscape(row.date)].join(","));
    } else {
      const reason = row.reason || "ไม่สามารถประมวลผลภาพนี้ได้";
      lines.push([csvEscape(`ไม่สามารถประมวลผลได้: ${reason} (ไฟล์: ${row.fileName})`), ""].join(","));
    }
  }

  return lines.join("\r\n");
}

export function downloadCsv(csv: string, filename = "extracted-data.csv") {
  // Prepend BOM so Excel opens Thai/UTF-8 text correctly.
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
