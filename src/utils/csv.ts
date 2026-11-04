// A spreadsheet will run anything that starts with these as a formula, so defuse it.
export const csvCell = (value: string | number | null): string => {
  let text = value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// UTF-8 with a BOM so Excel reads ₦ and accents correctly.
export const toCsv = (lines: (string | number | null)[][]): string =>
  "﻿" + lines.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
