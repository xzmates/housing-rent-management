/**
 * WeChat Mini Program / CloudBase mock for vitest
 */
const store = new Map();

function getCollectionData(name) {
  if (!store.has(name)) store.set(name, []);
  return store.get(name);
}

function copyObj(obj) {
  if (!obj) return obj;
  return JSON.parse(JSON.stringify(obj, (k, v) => {
    if (typeof v === 'object' && v !== null && v.serverDate) return new Date();
    if (k === 'serverDate' && typeof v === 'function') return undefined;
    return v;
  }));
}

const mockCommand = {
  gte(val) { return { gte: val }; },
  lte(val) { return { lte: val }; },
  and(arr) { return { and: arr }; },
  in(arr) { return { in: arr }; }
};

const collectionAPI = (name) => {
  let _filtered = null;
  let _limit = Infinity;

  const dataSource = () => (_filtered !== null ? _filtered : getCollectionData(name));

  return {
    doc(id) {
      return {
        get() {
          const col = getCollectionData(name);
          const item = col.find(d => d._id === id) || null;
          return Promise.resolve({ data: copyObj(item), errMsg: 'document.get:ok' });
        },
        update({ data }) {
          const col = getCollectionData(name);
          const item = col.find(d => d._id === id);
          if (item) Object.assign(item, data);
          return Promise.resolve({ stats: { updated: 1 }, errMsg: 'document.update:ok' });
        },
        remove() {
          const col = getCollectionData(name);
          store.set(name, col.filter(d => d._id !== id));
          return Promise.resolve({ stats: { removed: 1 }, errMsg: 'document.remove:ok' });
        }
      };
    },

    add({ data }) {
      const col = getCollectionData(name);
      const doc = Object.assign({ _id: 'id_' + name + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) }, copyObj(data));
      col.push(doc);
      return Promise.resolve({ _id: doc._id, errMsg: 'collection.add:ok' });
    },

    where(conditions) {
      const col = getCollectionData(name);
      _filtered = col.filter(item => {
        return Object.entries(conditions).every(([key, val]) => {
          if (val && typeof val === 'object' && val.in) return val.in.includes(item[key]);
          if (val && typeof val === 'object' && val.gte !== undefined) return item[key] >= val.gte;
          if (val && typeof val === 'object' && val.lte !== undefined) return item[key] <= val.lte;
          if (val && typeof val === 'object' && val.and) {
            return val.and.every(c => {
              const k = Object.keys(c)[0];
              const v = Object.values(c)[0];
              if (typeof v === 'object' && v.gte !== undefined) return item[k] >= v.gte;
              if (typeof v === 'object' && v.lte !== undefined) return item[k] <= v.lte;
              return item[k] === v;
            });
          }
          return item[key] === val;
        });
      });
      return this;
    },

    orderBy(field, dir) {
      const source = dataSource();
      const dirNum = dir === 'desc' ? -1 : 1;
      source.sort((a, b) => {
        const va = a[field], vb = b[field];
        if (va === undefined || va === null) return 1;
        if (vb === undefined || vb === null) return -1;
        return (va < vb ? -1 : va > vb ? 1 : 0) * dirNum;
      });
      return this;
    },

    limit(n) {
      _limit = n;
      return this;
    },

    get() {
      const source = dataSource();
      const slice = source.slice(0, _limit);
      return Promise.resolve({ data: copyObj(slice), errMsg: 'collection.get:ok' });
    }
  };
};

// Mock wx global
global.wx = {
  cloud: {
    database() {
      const api = {
        collection(name) { return collectionAPI(name); },
        command: mockCommand,
        serverDate() { return new Date(); }
      };
      return api;
    },
  }
};

global.getApp = () => ({
  globalData: { envId: 'test-env' }
});
