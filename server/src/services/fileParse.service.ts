/**
 * 上传附件的文本提取
 *
 * 目标是把「用户挂了个文件」变成「模型能读到的文本」。几点取舍：
 *
 * 1、按后缀分发而不是按 mime：mime 由浏览器给出，同一个 xlsx 在不同浏览器下可能是
 *    application/vnd.openxmlformats-officedocument.spreadsheetml.sheet 也可能是
 *    application/octet-stream（见 config.ts 里同样的说明）。后缀是上传时按白名单校验过的。
 *
 * 2、提取失败不抛异常，返回一句说明性的文本。附件的解析失败不该让整轮对话 500——
 *    用户真正想问的可能是"这个文件里写了什么"，把失败原因如实告诉模型，它才能回一句
 *    "这个文件我没能读取" 而不是让前端弹一个网络错误。
 *
 * 3、不做 OCR、不做 RAG。扫描件 PDF 提取不到文字就是提取不到，如实说明，
 *    等真有需求再上向量库或多模态。
 */
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

import { MAX_EXTRACT_CHARS } from '../config';

/** 只依赖 FileRow 里用到的三个字段，避免和 file.service 互相 import */
export type ExtractableFile = {
  fileName: string;
  suffix: string;
  storagePath: string;
};

export type ExtractResult = {
  text: string;
  /** 因超长被截断。透给调用方用于给模型加一句说明 */
  truncated: boolean;
};

// 用文本内容判断是否要提醒编码问题。非 UTF-8（GBK 等）的 txt 解出来会满屏 U+FFFD
const REPLACEMENT_CHAR = '�';
// 替换字符占比超过这个比例就认为编码不对。阈值取小值：正常 UTF-8 文本里
// 出现 U+FFFD 本身就罕见，一旦成片出现必然是解码错了
const BROKEN_ENCODING_RATIO = 0.05;

// 单次提取的字符上限：兜住 token 开销，也避免超大文件把上下文窗口挤爆
const extractLimit = MAX_EXTRACT_CHARS;

function truncate(text: string): ExtractResult {
  if (text.length <= extractLimit) return { text, truncated: false };
  return { text: text.slice(0, extractLimit), truncated: true };
}

/** 旧版 .xls 是二进制格式，exceljs 不支持，需要如实告诉用户而不是静默返回空 */
async function extractExcel(file: ExtractableFile): Promise<string> {
  if (file.suffix === 'xls') {
    return '（.xls 是 Excel 2003 的二进制格式，当前无法解析内容，请另存为 .xlsx 后重新上传）';
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file.storagePath);

  const chunks: string[] = [];
  workbook.eachSheet((sheet) => {
    chunks.push(`### 工作表：${sheet.name}`);
    sheet.eachRow({ includeEmpty: false }, (row) => {
      // row.values 是 1-based 的稀疏数组，下标 0 恒为 undefined，用 slice(1) 对齐列号。
      // 单元格可能是数字/日期/富文本对象，统一交给 String() 会得到 [object Object]，
      // 所以对富文本取 .text、对公式取 .result
      const cells = (row.values as unknown[]).slice(1).map((cell) => {
        if (cell === null || cell === undefined) return '';
        if (typeof cell === 'object') {
          const value = cell as { text?: string; result?: unknown; richText?: { text: string }[] };
          if (typeof value.text === 'string') return value.text;
          if (value.richText) return value.richText.map((part) => part.text).join('');
          if (value.result !== undefined) return String(value.result);
          return '';
        }
        return String(cell);
      });
      // 用制表符分隔，模型对表格结构的理解比纯空格拼串更稳
      chunks.push(cells.join('\t'));
    });
    chunks.push('');
  });

  return chunks.join('\n');
}

async function extractPdf(file: ExtractableFile): Promise<string> {
  const buffer = await fs.readFile(file.storagePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    // pdfjs 在 worker 里持有文档资源，不 destroy 会累积内存
    await parser.destroy();
  }
}

async function extractDocx(file: ExtractableFile): Promise<string> {
  // 用 extractRawText 而不是 convertToHtml：模型不需要段落样式，
  // HTML 只会多带一堆标签占 token
  const result = await mammoth.extractRawText({ path: file.storagePath });
  return result.value;
}

async function extractTxt(file: ExtractableFile): Promise<string> {
  const text = await fs.readFile(file.storagePath, 'utf8');

  // 中文 Windows 下记事本默认存 GBK，按 utf8 读会满屏 U+FFFD。
  // 这里不做转码（需要引入图标库和编码探测），只如实告知，
  // 否则模型会基于乱码内容一本正经地胡说
  const broken = [...text].filter((char) => char === REPLACEMENT_CHAR).length;
  if (text.length > 0 && broken / text.length > BROKEN_ENCODING_RATIO) {
    return `${text}\n\n（注意：该文本文件可能不是 UTF-8 编码，以上内容存在乱码）`;
  }
  return text;
}

/** 该后缀是否支持提取文本。图片不在此列——图片走多模态直传，不做 OCR */
const TEXT_EXTRACTABLE = new Set(['txt', 'pdf', 'docx', 'xls', 'xlsx']);

function isTextExtractable(suffix: string): boolean {
  return TEXT_EXTRACTABLE.has(suffix);
}

/**
 * 提取附件文本。任何失败都转成一句说明性文本返回，不往外抛
 */
async function extractText(file: ExtractableFile): Promise<ExtractResult> {
  if (!isTextExtractable(file.suffix)) {
    return { text: `（${file.fileName} 的内容格式暂不支持解析）`, truncated: false };
  }

  try {
    const raw =
      file.suffix === 'pdf' ? await extractPdf(file)
      : file.suffix === 'docx' ? await extractDocx(file)
      : file.suffix === 'txt' ? await extractTxt(file)
      : await extractExcel(file);

    const trimmed = raw.trim();
    if (!trimmed) {
      // 扫描件 PDF 会走到这里：能解析但提取不到文字
      return { text: '（未能从该文件中提取到文字内容，可能是扫描件或空文件）', truncated: false };
    }
    return truncate(trimmed);
  } catch (error) {
    console.error(`附件解析失败: ${file.fileName}`, error);
    const reason = error instanceof Error ? error.message : String(error);
    // 不把原始错误直接抛给用户看，但保留一句摘要，便于用户在界面上有线索
    return { text: `（解析该文件时出错：${reason.slice(0, 120)}）`, truncated: false };
  }
}

export { extractText, isTextExtractable };
