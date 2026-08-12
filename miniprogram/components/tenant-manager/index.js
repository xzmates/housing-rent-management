const pageConfig = require('../../pages/tenants/page-config');

const lifecycleNames = new Set(['onLoad', 'onShow', 'onPullDownRefresh']);
const methods = Object.keys(pageConfig).reduce((result, key) => {
  if (typeof pageConfig[key] === 'function' && !lifecycleNames.has(key)) result[key] = pageConfig[key];
  return result;
}, {});

methods.openHouseTab = function openHouseTab() {
  this.triggerEvent('switchhouse');
};

Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: { embedded: { type: Boolean, value: true } },
  data: pageConfig.data,
  lifetimes: {
    attached() {
      if (pageConfig.onLoad) pageConfig.onLoad.call(this, { from: 'property' });
      if (pageConfig.onShow) pageConfig.onShow.call(this);
    }
  },
  pageLifetimes: {
    show() {
      if (pageConfig.onShow) pageConfig.onShow.call(this);
    }
  },
  methods
});
