import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHot,
  normalizeTimestamp,
  normalizeId,
  canonicalizeUrl,
  normalizeSource,
  buildSnapshot,
} from "../src/utils/normalize.js";
import { largeSource, smallSource, malformedSource } from "./fixtures.js";
import type { RouterData } from "../src/types.js";

describe("normalizeHot 热度归一化", () => {
  test("数值原样返回", () => {
    assert.deepEqual(normalizeHot(12345), [12345, null]);
  });
  test("数字字符串与千分位转数值", () => {
    assert.deepEqual(normalizeHot("12,345"), [12345, null]);
    assert.deepEqual(normalizeHot("  678 "), [678, null]);
  });
  test("中文单位字符串", () => {
    assert.deepEqual(normalizeHot("1.2万"), [12000, null]);
    assert.deepEqual(normalizeHot("3亿"), [300000000, null]);
    assert.deepEqual(normalizeHot("5千"), [5000, null]);
  });
  test("英文单位字符串", () => {
    assert.deepEqual(normalizeHot("3.5k"), [3500, null]);
    assert.deepEqual(normalizeHot("2M"), [2000000, null]);
    assert.deepEqual(normalizeHot("1.5 billion"), [1500000000, null]);
  });
  test("缺失值返回 null 且不报诊断", () => {
    assert.deepEqual(normalizeHot(undefined), [null, null]);
    assert.deepEqual(normalizeHot(""), [null, null]);
  });
  test("无法解析的字符串产生诊断并兜底提取数字", () => {
    const [value, diag] = normalizeHot("热度 12345 人");
    assert.equal(value, 12345);
    assert.equal(diag?.type, "invalid-hot");
    const [bad, badDiag] = normalizeHot("not-a-number");
    assert.equal(bad, null);
    assert.equal(badDiag?.type, "invalid-hot");
  });
});

describe("normalizeTimestamp 时间归一化", () => {
  test("毫秒时间戳保持毫秒并输出带时区 ISO", () => {
    const [iso] = normalizeTimestamp(1700000000000);
    assert.equal(iso, "2023-11-14T22:13:20.000Z");
  });
  test("秒级时间戳自动乘 1000", () => {
    const [iso] = normalizeTimestamp(1700000000);
    assert.equal(iso, "2023-11-14T22:13:20.000Z");
  });
  test("纯数字字符串按秒/毫秒规则处理", () => {
    assert.equal(normalizeTimestamp("1700000000")[0], "2023-11-14T22:13:20.000Z");
    assert.equal(normalizeTimestamp("1700000000000")[0], "2023-11-14T22:13:20.000Z");
  });
  test("不同时区的 ISO 字符串统一为 UTC", () => {
    assert.equal(normalizeTimestamp("2023-11-14T22:13:20+08:00")[0], "2023-11-14T14:13:20.000Z");
    assert.equal(normalizeTimestamp("2024-01-02T03:04:05+09:00")[0], "2024-01-01T18:04:05.000Z");
    assert.equal(normalizeTimestamp("2023-12-31T23:59:59-05:00")[0], "2024-01-01T04:59:59.000Z");
  });
  test("0 与缺失视为空，不产生诊断", () => {
    assert.deepEqual(normalizeTimestamp(0), [null, null]);
    assert.deepEqual(normalizeTimestamp(undefined), [null, null]);
  });
  test("无法解析的字符串产生诊断", () => {
    const [iso, diag] = normalizeTimestamp("not-a-date");
    assert.equal(iso, null);
    assert.equal(diag?.type, "invalid-timestamp");
  });
});

describe("canonicalizeUrl URL 规范化", () => {
  test("查询参数排序、去哈希、去空参数后等价 URL 收敛为同一结果", () => {
    const a = canonicalizeUrl("https://e.com/p?z=9&a=1#section")[0];
    const b = canonicalizeUrl("https://e.com/p?a=1&z=9")[0];
    assert.equal(a, b);
    assert.equal(a, "https://e.com/p?a=1&z=9");
  });
  test("协议相对 URL 补 https", () => {
    assert.equal(canonicalizeUrl("//e.com/p")[0], "https://e.com/p");
  });
  test("相对 URL 原样保留", () => {
    assert.equal(canonicalizeUrl("t/topic/1")[0], "t/topic/1");
  });
  test("非法 URL 产生诊断", () => {
    const [url, diag] = canonicalizeUrl("ht!tp://[invalid");
    assert.equal(url, null);
    assert.equal(diag?.type, "invalid-url");
  });
});

describe("normalizeId ID 归一化", () => {
  test("数字转字符串", () => {
    assert.deepEqual(normalizeId(1001), ["1001", null]);
  });
  test("空 ID 产生诊断", () => {
    const [id, diag] = normalizeId("");
    assert.equal(id, null);
    assert.equal(diag?.type, "invalid-id");
  });
});

describe("normalizeSource 单源归一化（万级固定数据）", () => {
  const result = normalizeSource({ name: "large", data: largeSource });

  test("处理万级字符串热度且输入顺序保留", () => {
    assert.equal(result.inputCount, 12008);
    // 去掉 3 条（重复 URL、重复 ID 各 1 条，小源对照另算；本源为 dup-url-1 与 large-3 两条）
    assert.ok(result.items.length > 10000);
    result.items.forEach((item, order) => {
      assert.equal(item.source, "large");
      // index 是源内原始序号，天然单调递增 => 输入顺序保留
      if (order > 0) assert.ok(item.index > result.items[order - 1].index);
    });
  });

  test("热度全部为数值或 null", () => {
    for (const item of result.items) {
      assert.ok(item.hot === null || typeof item.hot === "number");
    }
    // 抽样验证字符串热度转换
    const first = result.items[0];
    assert.equal(first.hot, 0); // "0" 千分位形式
    const wan = result.items.find((item) => item.index === 1);
    assert.equal(wan?.hot, 1000); // "0.1万"
    const k = result.items.find((item) => item.index === 2);
    assert.equal(k?.hot, 2500); // "2.5k"
    const unparsable = result.items.find((item) => item.index === 4);
    assert.equal(unparsable?.hot, null);
    const missing = result.items.find((item) => item.index === 5);
    assert.equal(missing?.hot, null);
  });

  test("时间全部为带时区 ISO 或 null，且秒/毫秒与时区处理正确", () => {
    for (const item of result.items) {
      assert.ok(item.timestamp === null || /^\d{4}-\d{2}-\d{2}T.*Z$/.test(item.timestamp));
    }
    const ms = result.items.find((item) => item.index === 0);
    assert.equal(ms?.timestamp, "2023-11-14T22:13:20.000Z");
    const sec = result.items.find((item) => item.index === 1);
    assert.equal(sec?.timestamp, "2023-11-14T22:13:21.000Z");
    const offset = result.items.find((item) => item.index === 2);
    assert.equal(offset?.timestamp, "2023-11-14T14:13:20.000Z");
  });

  test("URL 规范化与来源内去重", () => {
    const urls = result.items.map((item) => item.url).filter((url): url is string => url !== null);
    assert.equal(new Set(urls).size, urls.length);
    // 查询参数被排序且哈希被移除
    assert.ok(result.items[0].url?.includes("a=1&b=2&z=0"));
    assert.ok(!result.items[0].url?.includes("#"));
    // 重复 URL 记录被丢弃并诊断
    assert.ok(result.diagnostics.some((d) => d.type === "duplicate-url"));
    // 重复 ID 记录被丢弃并诊断
    assert.ok(result.diagnostics.some((d) => d.type === "duplicate-id"));
    assert.equal(
      result.removed,
      result.diagnostics.filter((d) => d.type === "duplicate-id" || d.type === "duplicate-url")
        .length,
    );
  });

  test("缺字段记录被保留且字段回退稳定", () => {
    const missing = result.items.find((item) => item.id === "missing-fields");
    assert.ok(missing);
    assert.equal(missing?.hot, null);
    assert.equal(missing?.timestamp, null);
    assert.equal(missing?.url, null);
    assert.equal(missing?.mobileUrl, null);
  });

  test("ID 缺失时回退为来源内稳定 ID", () => {
    const fallback = result.items.find((item) => item.id === "large#12004");
    assert.ok(fallback);
    assert.equal(fallback?.url, null);
  });

  test("每条记录保留原始值", () => {
    const sample = result.items.find((item) => item.index === 1);
    assert.equal(sample?.raw.id, "large-1");
    assert.equal(sample?.raw.hot, "0.1万");
    assert.equal(typeof sample?.raw.timestamp, "number");
  });

  test("诊断只记录不抛出，且类型齐全", () => {
    const types = new Set(result.diagnostics.map((d) => d.type));
    for (const expected of [
      "invalid-hot",
      "invalid-timestamp",
      "invalid-id",
      "invalid-url",
      "duplicate-id",
      "duplicate-url",
    ]) {
      assert.ok(types.has(expected), `缺少诊断类型 ${expected}`);
    }
  });
});

describe("normalizeSource 小源：顺序、时区与重复 URL", () => {
  const result = normalizeSource({ name: "small", data: smallSource });

  test("保留输入顺序且重复 URL 只留第一条", () => {
    assert.equal(result.inputCount, 4);
    assert.equal(result.items.length, 3);
    assert.deepEqual(
      result.items.map((item) => item.id),
      ["1001", "1003", "small#3"],
    );
    assert.equal(result.removed, 1);
    assert.ok(result.diagnostics.some((d) => d.type === "duplicate-url"));
  });

  test("同一时刻的不同时区表达归一化为同一 UTC 时间", () => {
    assert.equal(result.items[0].timestamp, "2024-05-01T00:00:00.000Z");
  });

  test("mobileUrl 缺失时回退到规范化 url", () => {
    assert.equal(result.items[0].mobileUrl, result.items[0].url);
  });

  test("坏值条目不影响同源其他记录", () => {
    const bad = result.items.find((item) => item.id === "small#3");
    assert.equal(bad?.hot, null);
    assert.equal(bad?.timestamp, null);
    assert.ok(result.diagnostics.some((d) => d.type === "invalid-hot"));
    assert.ok(result.diagnostics.some((d) => d.type === "invalid-timestamp"));
  });
});

describe("buildSnapshot 多源快照", () => {
  test("保留来源输入顺序与来源名，单源错误只记录诊断", async () => {
    const snapshot = await buildSnapshot([
      { name: "small", loader: async () => smallSource },
      {
        name: "broken",
        loader: async () => {
          throw new Error("网络错误");
        },
      },
      { name: "large", loader: async () => largeSource },
      { name: "malformed", loader: async () => malformedSource },
    ]);

    assert.deepEqual(snapshot.sources, ["small", "broken", "large", "malformed"]);
    assert.deepEqual(snapshot.failedSources, ["broken"]);
    assert.equal(snapshot.results.length, 4);
    assert.equal(snapshot.results[0].name, "small");
    assert.equal(snapshot.results[1].name, "broken");
    assert.equal(snapshot.results[2].name, "large");
    assert.equal(snapshot.results[3].name, "malformed");

    // 坏源不污染其他来源
    assert.ok(snapshot.results[0].items.length > 0);
    assert.ok(snapshot.results[2].items.length > 10000);

    // 加载失败的来源只保留诊断
    assert.deepEqual(snapshot.results[1].items, []);
    assert.equal(snapshot.results[1].diagnostics[0].type, "source-error");
    assert.equal(snapshot.results[1].diagnostics[0].message, "网络错误");

    // 结构损坏来源产生 malformed-item 诊断
    assert.equal(snapshot.results[3].diagnostics[0].type, "malformed-item");

    // 总数只统计去重后的有效记录
    assert.equal(
      snapshot.total,
      snapshot.results.reduce((sum, source) => sum + source.items.length, 0),
    );
    assert.match(snapshot.snapshotTime, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  test("所有来源失败时快照仍可稳定返回", async () => {
    const snapshot = await buildSnapshot([
      {
        name: "a",
        loader: async () => {
          throw new Error("x");
        },
      },
      { name: "b", loader: async () => ({ ...malformedSource, name: "b" }) },
    ]);
    assert.equal(snapshot.total, 0);
    assert.deepEqual(snapshot.failedSources, ["a"]);
    assert.equal(snapshot.results[1].diagnostics[0].type, "malformed-item");
  });

  test("空来源列表返回空快照", async () => {
    const snapshot = await buildSnapshot([]);
    assert.deepEqual(snapshot.sources, []);
    assert.deepEqual(snapshot.results, []);
    assert.equal(snapshot.total, 0);
  });
});

describe("非对象条目隔离", () => {
  test("null 与原始类型条目只产生诊断不抛出", () => {
    const data: RouterData = {
      name: "weird",
      title: "怪异来源",
      type: "测试榜",
      total: 0,
      updateTime: "2026-11-16T00:00:00.000Z",
      fromCache: false,
      data: [
        null,
        "just-a-string",
        42,
        {
          id: "ok",
          title: "正常条目",
          url: "https://e.example/ok",
          mobileUrl: "https://e.example/ok",
        },
      ] as unknown as RouterData["data"],
    };
    const result = normalizeSource({ name: "weird", data });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, "ok");
    assert.equal(result.diagnostics.filter((d) => d.type === "malformed-item").length, 3);
    assert.equal(result.removed, 3);
  });
});
