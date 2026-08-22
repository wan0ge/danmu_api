// 本地 Node 旧版本兼容层：补齐 @dan-uni/dan-any 依赖在 Node 18 下缺失的原生 API
// dan-any 的打包产物直接调用了 Node 20+ 才提供的 Array 实例方法与 Map 迭代器原型方法，
// 在 Node 18 下会导致播放器格式（ddplay/dplayer/artplayer/vod/baha）与 DanUni 高级格式导出失败。
// 仅在对应 API 不存在时注入补丁（Node 20+ 下全部跳过，零副作用）。
const { prototype: arrayProto } = Array;

if (typeof arrayProto.toSorted !== 'function') {
  arrayProto.toSorted = function (compareFn) {
    return Array.prototype.slice.call(this).sort(compareFn);
  };
}

if (typeof arrayProto.toReversed !== 'function') {
  arrayProto.toReversed = function () {
    return Array.prototype.slice.call(this).reverse();
  };
}

// Map/Set 迭代器原型方法：dan-any 在 MapIterator 上链式调用 filter/map/some/toArray，
// 这类方法由 @rolldown/plugin-node-polyfills 在 Node 20+ 注入，Node 18 下缺失。
for (const proto of [Map.prototype, Set.prototype]) {
  const origValues = proto.values;
  const origKeys = proto.keys;
  const origEntries = proto.entries;
  const attach = (methodName, factory) => {
    if (typeof proto[methodName] === 'function' && !proto[methodName].__legacyPolyfill) {
      const orig = proto[methodName];
      const wrapped = factory(orig);
      wrapped.__legacyPolyfill = true;
      proto[methodName] = wrapped;
    }
  };
  // 让迭代器方法返回数组包装，从而获得 Array 原型上的 filter/map/some/toArray 等行为
  const wrapToArray = (origFn) => function () {
    return Array.from(origFn.call(this));
  };
  attach('values', wrapToArray);
  attach('keys', wrapToArray);
  attach('entries', wrapToArray);
}
