import { log } from './log-util.js';

// =====================
// 请求合并去重工具
// =====================

// 全局请求合并 Map，按模块 key 区分
// 存储正在执行的请求 Promise，键为去重标识
const pendingRequests = new Map();

/**
 * 请求合并去重
 * 当相同 key 的请求仍在执行时，后续请求复用已有的 Promise 结果
 * 否则执行 factory 并记录 Promise 供后续合并复用
 *
 * 说明：
 * - factory 必须返回一个 Response 对象
 * - 因 Response body 只能消费一次，合并请求通过 response.clone() 获取独立副本
 * - 任务完成或失败后自动从 Map 中清理
 *
 * @param {string}   key     去重标识，由调用方按业务规则构造
 * @param {Function} factory 异步工厂函数，返回 Response
 * @returns {Promise<Response>} 合并或新执行的响应
 */
export async function deduplicateRequest(key, factory) {
    if (pendingRequests.has(key)) {
        log("info", `[Utils] [Dedup] 请求合并: ${key}`);
        const sharedResponse = await pendingRequests.get(key);
        return sharedResponse.clone();
    }

    const promise = factory();
    pendingRequests.set(key, promise);

    try {
        return await promise;
    } finally {
        pendingRequests.delete(key);
    }
}
