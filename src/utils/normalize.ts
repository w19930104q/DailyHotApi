import type {
  ListItem,
  NormalizedItem,
  NormalizedSnapshot,
  NormalizedSource,
  RouterData,
  SnapshotDiagnostic,
} from "../types.js";

/**
 * 多来源榜单数据归一化工具
 * - 热度：字符串 / 中文单位 / 千分位 / 英文单位 -> 数值
 * - 时间：秒 / 毫秒时间戳 / 各类日期字符串 -> 带时区 ISO 8601
 * - ID 与 URL：按来源内稳定规则去重
 * - 单源坏数据只记录诊断，不影响其他来源
 */

// 中文数字单位
const CHINESE_UNITS: Record<string, number> = {
  亿: 1e8,
  万: 1e4,
  千: 1e3,
  百: 1e2,
};

// 英文数字单位（按长度降序匹配，避免 k 与 kb 之类的前缀冲突）
const ENGLISH_UNITS: Array<[RegExp, number]> = [
  [/billion/i, 1e9],
  [/million/i, 1e6],
  [/trillion/i, 1e12],
  [/[kK]\b/, 1e3],
  [/[mM]\b/, 1e6],
  [/[bB]\b/, 1e9],
];

/**
 * 将任意热度值归一化为数值
 * @returns [数值或 null, 无法解析时的诊断信息]
 */
export const normalizeHot = (value: unknown): [number | null, SnapshotDiagnostic | null] => {
  // null / undefined / 空字符串视为缺失
  if (value === null || value === undefined || value === "") {
    return [null, null];
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? [value, null] : [null, diag("invalid-hot", value)];
  }
  if (typeof value === "boolean") {
    return [null, diag("invalid-hot", value)];
  }
  if (typeof value === "bigint") {
    return [Number(value), null];
  }

  const text = String(value).trim();
  if (!text) {
    return [null, null];
  }

  // 中文单位，如 "1.2万"、"3亿"、"5千"、"8百"
  for (const [unit, multiplier] of Object.entries(CHINESE_UNITS)) {
    if (text.includes(unit)) {
      const num = parseFloat(text.replace(unit, "").replace(/[,，\s]/g, ""));
      if (Number.isFinite(num)) return [num * multiplier, null];
      return [null, diag("invalid-hot", value)];
    }
  }

  // 英文单位，如 "1.2k"、"3M"、"2 billion"
  for (const [pattern, multiplier] of ENGLISH_UNITS) {
    if (pattern.test(text)) {
      const num = parseFloat(text.replace(/[a-zA-Z\s,，]/g, ""));
      if (Number.isFinite(num)) return [num * multiplier, null];
      return [null, diag("invalid-hot", value)];
    }
  }

  // 普通数字字符串：去掉千分位逗号与空白
  const plain = text.replace(/[,，\s]/g, "");
  const num = Number(plain);
  if (Number.isFinite(num)) {
    return [num, null];
  }

  // 提取字符串中的首个数字片段作为兜底，如 "热度 12345 人"
  const matched = text.match(/-?\d+(?:\.\d+)?/);
  if (matched) {
    const fallback = Number(matched[0]);
    if (Number.isFinite(fallback)) {
      return [fallback, diag("invalid-hot", value, "已提取字符串中的数字部分")];
    }
  }

  return [null, diag("invalid-hot", value)];
};

/**
 * 将秒 / 毫秒级 Unix 时间戳统一为毫秒
 */
const normalizeUnixTimestamp = (num: number): number => {
  // 以 2000-01-01 作为毫秒时间戳参考点，与 getTime 的判断规则保持一致
  return num > 946684800000 ? num : num * 1000;
};

/**
 * 将任意时间值归一化为带时区 ISO 8601 字符串
 * @returns [ISO 字符串或 null, 无法解析时的诊断信息]
 */
export const normalizeTimestamp = (value: unknown): [string | null, SnapshotDiagnostic | null] => {
  // null / undefined / 0 / 空字符串视为缺失（0 是部分路由的占位值）
  if (value === null || value === undefined || value === "" || value === 0) {
    return [null, null];
  }

  let milliseconds: number | undefined;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return [null, diag("invalid-timestamp", value)];
    }
    milliseconds = normalizeUnixTimestamp(value);
  } else if (typeof value === "bigint") {
    milliseconds = normalizeUnixTimestamp(Number(value));
  } else if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return [null, null];
    }
    // 纯数字字符串：秒 / 毫秒时间戳
    if (/^-?\d+$/.test(text)) {
      milliseconds = normalizeUnixTimestamp(parseInt(text, 10));
    } else {
      const parsed = Date.parse(text);
      if (Number.isFinite(parsed)) {
        milliseconds = parsed;
      }
    }
  } else if (value instanceof Date) {
    milliseconds = value.getTime();
  }

  if (milliseconds === undefined || !Number.isFinite(milliseconds)) {
    return [null, diag("invalid-timestamp", value)];
  }

  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    return [null, diag("invalid-timestamp", value)];
  }
  return [date.toISOString(), null];
};

/**
 * 规范化 URL：
 * - 补全协议相对 URL（//example.com -> https://example.com）
 * - 去除哈希片段、排序查询参数、去除空参数
 * - 保留相对 URL（不以 / 或协议开头），仅做 trim
 * @returns [规范化后的 URL 或 null, 诊断信息]
 */
export const canonicalizeUrl = (value: unknown): [string | null, SnapshotDiagnostic | null] => {
  if (value === null || value === undefined || value === "") {
    return [null, null];
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return [null, diag("invalid-url", value)];
  }

  let text = String(value).trim();
  if (!text) {
    return [null, null];
  }

  // 协议相对 URL，统一补 https
  if (text.startsWith("//")) {
    text = `https:${text}`;
  }

  // 相对 URL（如 "t/12345"）无法独立定位，原样保留作为来源内稳定键；
  // 但含有 "://" 却不满足绝对 URL 规则的（如 "ht!tp://x"）属于坏数据
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(text) && !text.startsWith("/")) {
    if (text.includes("://")) {
      return [null, diag("invalid-url", value)];
    }
    return [text, null];
  }

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return [null, diag("invalid-url", value)];
  }

  // 哈希片段不参与资源定位，统一丢弃
  parsed.hash = "";
  // 排序查询参数并丢弃空值参数，保证同一资源只有一种表示
  const params = [...parsed.searchParams.entries()]
    .filter(([, v]) => v !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  parsed.search = "";
  for (const [key, val] of params) {
    parsed.searchParams.append(key, val);
  }

  return [parsed.toString(), null];
};

/**
 * 将任意 ID 归一化为字符串
 * @returns [ID 字符串或 null, 诊断信息]
 */
export const normalizeId = (value: unknown): [string | null, SnapshotDiagnostic | null] => {
  if (value === null || value === undefined || value === "") {
    return [null, diag("invalid-id", value)];
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return [String(value), null];
  }
  if (typeof value === "boolean") {
    return [null, diag("invalid-id", value)];
  }
  const text = String(value).trim();
  return text ? [text, null] : [null, diag("invalid-id", value)];
};

const DIAGNOSTIC_LABELS: Record<string, string> = {
  hot: "热度",
  timestamp: "时间",
  id: "ID",
  url: "URL",
};

const diag = (type: string, value: unknown, message?: string): SnapshotDiagnostic => {
  const field = type.replace("invalid-", "");
  return {
    type,
    message: message ?? `无法解析的${DIAGNOSTIC_LABELS[field] ?? field}值`,
    value,
  };
};

export interface NormalizeSourceOptions {
  // 来源名称（对应单源路由名）
  name: string;
  // 路由返回的榜单数据
  data: RouterData;
}

/**
 * 归一化单个来源：
 * 保留输入顺序，ID 与 URL 各自按来源内稳定规则去重（保留首次出现的记录）
 */
export const normalizeSource = (options: NormalizeSourceOptions): NormalizedSource => {
  const { name, data } = options;
  const diagnostics: SnapshotDiagnostic[] = [];
  const items: NormalizedItem[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();

  const list: unknown = data?.data;
  if (!Array.isArray(list)) {
    return {
      name,
      items,
      inputCount: 0,
      removed: 0,
      diagnostics: [
        {
          type: "malformed-item",
          message: "来源数据缺少数组类型的 data 字段",
          value: typeof list,
        },
      ],
    };
  }

  let removed = 0;

  list.forEach((entry, index) => {
    const pushDiagnostic = (d: SnapshotDiagnostic) => {
      diagnostics.push({ ...d, index });
    };

    if (entry === null || typeof entry !== "object") {
      pushDiagnostic({ type: "malformed-item", message: "条目不是对象", value: entry });
      removed += 1;
      return;
    }

    const item = entry as Partial<ListItem> & Record<string, unknown>;

    // 热度归一化
    const [hot, hotDiag] = normalizeHot(item.hot);
    if (hotDiag) pushDiagnostic(hotDiag);

    // 时间归一化
    const [timestamp, timeDiag] = normalizeTimestamp(item.timestamp);
    if (timeDiag) pushDiagnostic(timeDiag);

    // ID 归一化与来源内去重
    const [rawId, idDiag] = normalizeId(item.id);
    if (idDiag) pushDiagnostic(idDiag);
    const id = rawId ?? `${name}#${index}`;
    if (seenIds.has(id)) {
      pushDiagnostic({
        type: "duplicate-id",
        message: `重复 ID「${id}」，保留首次出现的记录`,
        value: item.id,
      });
      removed += 1;
      return;
    }
    seenIds.add(id);

    // URL 规范化与来源内去重
    const [url, urlDiag] = canonicalizeUrl(item.url);
    if (urlDiag) pushDiagnostic(urlDiag);
    const [mobileUrl, mobileUrlDiag] = canonicalizeUrl(item.mobileUrl);
    if (mobileUrlDiag) pushDiagnostic(mobileUrlDiag);

    if (url !== null && seenUrls.has(url)) {
      pushDiagnostic({
        type: "duplicate-url",
        message: `重复 URL「${url}」，保留首次出现的记录`,
        value: item.url,
      });
      removed += 1;
      return;
    }
    if (url !== null) seenUrls.add(url);

    items.push({
      source: name,
      index,
      hot,
      timestamp,
      id,
      url,
      mobileUrl: mobileUrl ?? url,
      title: typeof item.title === "string" ? item.title : String(item.title ?? ""),
      // 保留该条记录的原始值
      raw: { ...item },
    });
  });

  return {
    name,
    items,
    inputCount: list.length,
    removed,
    diagnostics,
  };
};

export interface SnapshotSourceInput {
  // 来源名称（对应单源路由名）
  name: string;
  // 单源数据加载器，抛出错误时只影响该来源
  loader: () => Promise<RouterData>;
}

/**
 * 构建多来源归一化快照
 * - 保留输入顺序与来源名
 * - 各来源并发加载，单源失败只记录诊断，不污染其他来源
 */
export const buildSnapshot = async (inputs: SnapshotSourceInput[]): Promise<NormalizedSnapshot> => {
  const settled = await Promise.all(
    inputs.map(async (input) => {
      try {
        const data = await input.loader();
        return { name: input.name, data, error: null as Error | null };
      } catch (error) {
        return {
          name: input.name,
          data: null,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    }),
  );

  const sources: string[] = [];
  const results: NormalizedSource[] = [];
  const failedSources: string[] = [];

  // 按输入顺序汇总
  settled.forEach((entry, order) => {
    sources[order] = entry.name;
    if (entry.error || !entry.data) {
      failedSources.push(entry.name);
      results[order] = {
        name: entry.name,
        items: [],
        inputCount: 0,
        removed: 0,
        diagnostics: [
          {
            type: "source-error",
            message: entry.error?.message ?? "来源加载失败",
          },
        ],
      };
      return;
    }
    results[order] = normalizeSource({ name: entry.name, data: entry.data });
  });

  return {
    snapshotTime: new Date().toISOString(),
    sources,
    results,
    total: results.reduce((sum, source) => sum + source.items.length, 0),
    failedSources,
  };
};
