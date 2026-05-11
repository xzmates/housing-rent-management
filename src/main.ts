import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import App from "./App.vue";

// 导入页面组件
import DashboardPage from "./pages/DashboardPage.vue";
import HousesPage from "./pages/HousesPage.vue";
import TenantsPage from "./pages/TenantsPage.vue";
import PaymentsPage from "./pages/PaymentsPage.vue";
import UtilityPage from "./pages/UtilityPage.vue";
import SettingsPage from "./pages/SettingsPage.vue";
import ContractPage from "./pages/ContractPage.vue";

// 定义路由
const routes = [
  { path: "/", redirect: "/dashboard" },
  { path: "/dashboard", component: DashboardPage },
  { path: "/houses", component: HousesPage },
  { path: "/tenants", component: TenantsPage },
  { path: "/payments", component: PaymentsPage },
  { path: "/utility", component: UtilityPage },
  { path: "/settings", component: SettingsPage },
  { path: "/contract", component: ContractPage },
  { path: "/:pathMatch(.*)*", redirect: "/" }, // 404重定向到首页
];

// 创建路由实例 - 使用hash模式避免静态托管时的刷新404问题
const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// 创建应用实例
const app = createApp(App);

// 使用路由
app.use(router);

// 挂载应用
app.mount("#app");
