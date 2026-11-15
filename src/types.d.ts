import type { Context } from "hono";
import type { ResponseType } from "axios";

// Context
export type ListContext = Context;

// 榜单数据
export interface ListItem {
  id: number | string;
  title: string;
  cover?: string;
  author?: string;
  desc?: string;
  hot: number | undefined;
  timestamp: number | undefined;
  url: string;
  mobileUrl: string;
}

// 路由接口数据
export interface RouterResType {
  updateTime: string | number;
  fromCache: boolean;
  data: ListItem[];
  message?: string;
}

// 路由数据
export interface RouterData extends RouterResType {
  name: string;
  title: string;
  type: string;
  description?: string;
  params?: Record<string, string | object>;
  total: number;
  link?: string;
}

// 请求类型
export interface Get {
  url: string;
  headers?: Record<string, string | string[]>;
  params?: Record<string, string | number>;
  timeout?: number;
  noCache?: boolean;
  ttl?: number;
  originaInfo?: boolean;
  responseType?: ResponseType;
}

export interface Post {
  url: string;
  headers?: Record<string, string | string[]>;
  body?: string | object | Buffer | undefined;
  timeout?: number;
  noCache?: boolean;
  ttl?: number;
  originaInfo?: boolean;
}

// 参数类型
export interface Options {
  [key: string]: string | number | undefined;
}

// 单源归一化诊断信息
export interface SnapshotDiagnostic {
  // 诊断类型，如 invalid-hot / invalid-timestamp / invalid-id / invalid-url / duplicate-id / duplicate-url / malformed-item / source-error
  type: string;
  // 源内条目序号（从 0 开始），源级错误时可能不存在
  index?: number;
  // 诊断详情
  message: string;
  // 触发诊断的原始值
  value?: unknown;
}

// 归一化后的单条记录
export interface NormalizedItem {
  // 来源名称（对应单源路由名）
  source: string;
  // 源内序号（从 0 开始），保留输入顺序
  index: number;
  // 归一化后的数值热度，无法解析时为 null
  hot: number | null;
  // 归一化后的带时区 ISO 8601 时间，无法解析时为 null
  timestamp: string | null;
  // 来源内去重后的稳定 ID
  id: string;
  // 规范化后的去重 URL，无有效 URL 时为 null
  url: string | null;
  // 规范化后的移动端 URL，无有效 URL 时为 null
  mobileUrl: string | null;
  title: string;
  // 该条记录的原始值
  raw: Record<string, unknown>;
}

// 单个来源的归一化结果
export interface NormalizedSource {
  name: string;
  // 去重后保留的归一化记录
  items: NormalizedItem[];
  // 输入条目总数（去重前）
  inputCount: number;
  // 去重丢弃的条目数
  removed: number;
  // 该来源的诊断信息，不影响其他来源
  diagnostics: SnapshotDiagnostic[];
}

// 多源归一化快照
export interface NormalizedSnapshot {
  // 快照生成时间（带时区 ISO 8601）
  snapshotTime: string;
  // 请求的来源名称，保留输入顺序与去重结果
  sources: string[];
  // 各来源的归一化结果，顺序与 sources 一致
  results: NormalizedSource[];
  // 全部来源的记录总数（去重后）
  total: number;
  // 出现错误的来源名称
  failedSources: string[];
}
