/** Small RFC 4180 CSV reader: quoted fields, escaped quotes, embedded commas/newlines, CRLF, BOM. Never evaluates anything. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = []; let row: string[] = [], field = "", inQ = false, any = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c;
    } else if (c === '"' && field === "") { inQ = true; any = true; }
    else if (c === ",") { row.push(field); field = ""; any = true; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; if (any || field !== "" || row.length) { row.push(field); rows.push(row); } row = []; field = ""; any = false; }
    else { field += c; any = true; }
  }
  if (inQ) throw new Error("The file has an unclosed quote.");
  if (any || field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
