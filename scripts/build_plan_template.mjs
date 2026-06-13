import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = new URL("../templates/", import.meta.url);
await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("外协计划导入模板");
sheet.showGridLines = false;

sheet.getRange("A1:G1").merge();
sheet.getRange("A1").values = [["外协计划导入模板"]];
sheet.getRange("A1").format = {
  fill: "#226957",
  font: { bold: true, color: "#FFFFFF", size: 16 },
  horizontalAlignment: "center",
};
sheet.getRange("A1").format.rowHeightPx = 36;

sheet.getRange("A2:G3").merge();
sheet.getRange("A2").values = [
  [
    "请从第 6 行开始填写数据。带 * 的列为必填。日期建议使用 yyyy-mm-dd 格式；优先级可填写：普通、加急、重点。导入时会自动跳过空白行。",
  ],
];
sheet.getRange("A2").format = {
  fill: "#F4F6F2",
  font: { color: "#425047" },
  wrapText: true,
  verticalAlignment: "center",
};
sheet.getRange("A2").format.rowHeightPx = 46;

const headers = [["项目名称*", "外协方*", "工序/内容*", "数量*", "计划交期*", "优先级", "备注"]];
sheet.getRange("A5:G5").values = headers;
sheet.getRange("A5:G5").format = {
  fill: "#174A3E",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "all", style: "thin", color: "#DCE5DE" },
};
sheet.getRange("A5:G5").format.rowHeightPx = 28;

sheet.getRange("A6:G8").values = [
  ["机加工批次 A-0613", "华东精密加工", "CNC", 120, new Date("2026-06-20"), "普通", "按图纸 V2 执行"],
  ["表面处理 B-002", "华东表面处理", "喷涂", 80, new Date("2026-06-25"), "加急", "颜色按色卡确认"],
  [null, null, null, null, null, null, null],
];
sheet.getRange("A6:G105").format = {
  borders: { preset: "all", style: "thin", color: "#E5EAE3" },
  verticalAlignment: "center",
};
sheet.getRange("D6:D105").format.numberFormat = "0";
sheet.getRange("E6:E105").format.numberFormat = "yyyy-mm-dd";
sheet.getRange("F6:F105").dataValidation = { rule: { type: "list", values: ["普通", "加急", "重点"] } };

sheet.getRange("A4:G4").values = [["字段", "字段", "字段", "字段", "字段", "字段", "字段"]];
sheet.getRange("A4:G4").format = { font: { color: "#FFFFFF" } };
sheet.freezePanes.freezeRows(5);

const widths = [180, 170, 150, 90, 125, 95, 260];
widths.forEach((width, index) => {
  sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidthPx = width;
});

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(fileURLToPath(new URL("./外协计划导入模板.xlsx", outputDir)));
