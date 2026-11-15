import type { ListContext, NormalizedSnapshot, RouterData } from "../types.js";
import { buildSnapshot } from "../utils/normalize.js";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 来源名仅允许小写字母、数字与连字符，从根本上杜绝目录穿越
const SOURCE_NAME_PATTERN = /^[a-z0-9-]+$/i;

// 校验路由文件是否存在（兼容 tsx 开发环境与 dist 构建产物）
const routeExists = (name: string): boolean =>
  fs.existsSync(path.join(__dirname, `${name}.js`)) ||
  fs.existsSync(path.join(__dirname, `${name}.ts`));

// 解析来源参数：支持 sources=a,b 与重复 source=a&source=b 两种写法，保留输入顺序并去重
const parseSourceNames = (c: ListContext): string[] => {
  const names: string[] = [];
  const seen = new Set<string>();
  const collect = (raw: string | undefined) => {
    if (!raw) return;
    raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((name) => {
        if (!seen.has(name)) {
          seen.add(name);
          names.push(name);
        }
      });
  };
  collect(c.req.query("sources"));
  c.req.queries("source")?.forEach(collect);
  return names;
};

type SnapshotRouteData = RouterData & NormalizedSnapshot;

export const handleRoute = async (c: ListContext, noCache: boolean): Promise<SnapshotRouteData> => {
  const names = parseSourceNames(c);

  const baseMeta = {
    name: "snapshot",
    title: "多源归一化快照",
    type: "snapshot",
    description: "一次请求多个来源，输出归一化后的跨来源榜单快照",
    link: "",
    fromCache: false,
    updateTime: new Date().toISOString(),
    // 快照数据位于 results 中；保留空 data 以兼容通用路由封装的 limit / RSS 逻辑
    data: [],
  };

  if (names.length === 0) {
    return {
      ...baseMeta,
      code: 400,
      message: "缺少来源参数，请通过 sources=weibo,zhihu 或重复 source 参数指定至少一个来源",
      snapshotTime: new Date().toISOString(),
      sources: [],
      results: [],
      total: 0,
      failedSources: [],
    } as SnapshotRouteData;
  }

  const illegalName = names.find((name) => !SOURCE_NAME_PATTERN.test(name));
  if (illegalName) {
    return {
      ...baseMeta,
      code: 400,
      message: `非法来源名「${illegalName}」，仅允许字母、数字与连字符`,
      snapshotTime: new Date().toISOString(),
      sources: names,
      results: [],
      total: 0,
      failedSources: names,
    } as SnapshotRouteData;
  }

  const snapshot = await buildSnapshot(
    names.map((name) => ({
      name,
      loader: async () => {
        // 不存在的路由按单源错误处理，只记录诊断，不影响其他来源
        if (!routeExists(name)) {
          throw new Error(`来源「${name}」不存在`);
        }
        const module = await import(`./${name}.js`);
        if (typeof module?.handleRoute !== "function") {
          throw new Error(`来源「${name}」无法加载`);
        }
        return module.handleRoute(c, noCache) as Promise<RouterData>;
      },
    })),
  );

  return {
    ...baseMeta,
    ...snapshot,
  };
};
