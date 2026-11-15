import type { ListItem, RouterData } from "../src/types.js";

/**
 * 固定多源测试数据（确定性、无网络依赖）
 * 覆盖：万级字符串热度、缺失字段、重复 URL、时区差异、输入顺序、秒/毫秒时间戳、坏数据隔离
 */

// 万级数据量：循环生成 12000 条确定性记录
const LARGE_COUNT = 12000;

const buildLargeSource = (): ListItem[] => {
  const items: ListItem[] = [];
  for (let i = 0; i < LARGE_COUNT; i++) {
    // 热度在字符串、中文单位、英文单位、千分位、数值、缺失之间轮转
    const hot =
      i % 6 === 0
        ? `${(i * 137).toLocaleString("en-US")}` // "12,345" 千分位字符串
        : i % 6 === 1
          ? `${(i / 10).toFixed(1)}万` // "12.3万" 中文单位字符串
          : i % 6 === 2
            ? `${i % 97}.5k` // "3.5k" 英文单位字符串
            : i % 6 === 3
              ? i * 1000 // 数值
              : i % 6 === 4
                ? "热度不可用" // 无法解析的字符串
                : undefined; // 缺失
    // 时间在毫秒、秒、ISO（含不同时区）、裸字符串、缺失之间轮转
    let timestamp: number | string | undefined;
    if (i % 5 === 0)
      timestamp = 1700000000000 + i; // 毫秒
    else if (i % 5 === 1)
      timestamp = 1700000000 + i; // 秒
    else if (i % 5 === 2)
      timestamp = "2023-11-14T22:13:20+08:00"; // 带时区 ISO
    else if (i % 5 === 3)
      timestamp = "2023-11-14T14:13:20.000Z"; // UTC ISO
    else timestamp = undefined; // 缺失
    items.push({
      id: `large-${i}`,
      title: `大批量条目 ${i}`,
      hot: hot as number | string | undefined,
      timestamp: timestamp as number | string,
      url: `https://large.example.com/item/${i}?b=2&a=1&z=${i}#frag`,
      mobileUrl: `https://m.large.example.com/item/${i}`,
    });
  }

  // 特殊记录：重复 URL、重复 ID、缺字段、坏值、相对/协议相对 URL
  const specials: Array<Partial<ListItem> & Record<string, unknown>> = [
    {
      // 与 large-7 的规范化 URL 完全相同（仅参数顺序与哈希不同）
      id: "dup-url-1",
      title: "重复 URL 第一条",
      hot: "1.2万",
      timestamp: 1700000007,
      url: "https://large.example.com/item/7?z=7&a=1&b=2#changed",
      mobileUrl: "",
    },
    {
      // 与 large-3 同 ID
      id: "large-3",
      title: "重复 ID 记录",
      hot: undefined,
      timestamp: undefined,
      url: "https://large.example.com/unique-dup-id",
      mobileUrl: "https://large.example.com/unique-dup-id",
    },
    {
      // 字段大面积缺失：无 hot、无 timestamp、无 url、无 mobileUrl
      id: "missing-fields",
      title: "缺字段记录",
    },
    {
      // 热度与时间均无法解析
      id: "bad-values",
      title: "坏值记录",
      hot: "not-a-number",
      timestamp: "not-a-date",
      url: "https://large.example.com/bad",
      mobileUrl: "https://large.example.com/bad",
    },
    {
      // ID 缺失 -> 回退为来源内稳定 ID；URL 非法
      title: "无 ID 记录",
      hot: null,
      timestamp: 0,
      url: "ht!tp://[invalid",
      mobileUrl: "",
    },
    {
      // 协议相对 URL 与空哈希
      id: "protocol-relative",
      title: "协议相对 URL",
      hot: "2,500",
      timestamp: "2024-01-02T03:04:05+09:00",
      url: "//large.example.com/protocol-relative",
      mobileUrl: "//large.example.com/protocol-relative?utm_source=x",
    },
    {
      // 相对 URL 原样保留
      id: "relative-url",
      title: "相对 URL",
      hot: 321,
      timestamp: 1700000000000,
      url: "t/topic/9981",
      mobileUrl: "t/topic/9981",
    },
    {
      // 非对象条目的对照由 malformedSource 覆盖，这里保留一个空标题对象
      id: "empty-title",
      title: "",
      hot: 0,
      timestamp: "2023-12-31T23:59:59-05:00",
      url: "https://large.example.com/empty-title?keep=",
      mobileUrl: "",
    },
  ];
  return [...items, ...specs(specials)];
};

const specs = (rows: Array<Partial<ListItem>>): ListItem[] =>
  rows.map(
    (row) =>
      ({
        id: row.id,
        title: row.title,
        cover: row.cover,
        author: row.author,
        desc: row.desc,
        hot: row.hot,
        timestamp: row.timestamp,
        url: row.url,
        mobileUrl: row.mobileUrl,
      }) as ListItem,
  );

export const largeSource: RouterData = {
  name: "large",
  title: "大批量来源",
  type: "测试榜",
  total: 0,
  updateTime: "2026-11-16T00:00:00.000Z",
  fromCache: false,
  data: buildLargeSource(),
};

// 小批量来源：验证顺序、时区、URL 规范化与跨源互不影响
export const smallSource: RouterData = {
  name: "small",
  title: "小批量来源",
  type: "测试榜",
  total: 0,
  updateTime: "2026-11-16T00:00:00.000Z",
  fromCache: false,
  data: [
    {
      id: 1001,
      title: "小源第一条",
      hot: "3.5亿",
      timestamp: "2024-05-01T08:00:00+08:00",
      url: "https://small.example.com/a?z=9&a=1#section",
      mobileUrl: "",
    },
    {
      id: 1002,
      title: "小源第二条",
      hot: 42,
      timestamp: 1714550400, // 秒级，与上一条同一时刻（UTC 2024-05-01T00:00:00Z）
      url: "https://small.example.com/a?a=1&z=9", // 规范化后与第一条相同 -> 重复 URL
      mobileUrl: "https://m.small.example.com/a",
    },
    {
      id: 1003,
      title: "小源第三条",
      hot: "1,234,567",
      timestamp: "2024-06-01T12:00:00.000Z",
      url: "https://small.example.com/b",
      mobileUrl: "https://m.small.example.com/b",
    },
    {
      id: "",
      title: "小源坏条目",
      hot: "bad",
      timestamp: "bad",
      url: "not a url",
      mobileUrl: "",
    },
  ],
};

// 结构损坏来源：data 不是数组
export const malformedSource = {
  name: "malformed",
  title: "结构损坏来源",
  type: "测试榜",
  total: 0,
  updateTime: "2026-11-16T00:00:00.000Z",
  fromCache: false,
  data: { unexpected: true },
} as unknown as RouterData;
