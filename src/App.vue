<template>
  <div class="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
    <div
      v-if="isLoading"
      class="flex grow flex-col items-center justify-center px-4"
    >
      <span class="loading loading-spinner loading-lg text-primary"></span>
      <p class="mt-4 text-sm opacity-70">加载中...</p>
    </div>
    <template v-else>
      <!-- 桌面端导航栏 (md+) -->
      <AppNavbar class="hidden md:block" />

      <!-- 主内容区 -->
      <main class="grow pb-16 md:pb-0">
        <router-view v-slot="{ Component }">
          <transition name="page" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>

      <!-- 桌面端底部 (md+) -->
      <AppFooter class="hidden md:block" />

      <!-- 移动端底部标签栏 (小于 md) -->
      <BottomTabBar class="md:hidden fixed bottom-0 left-0 right-0" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterView } from "vue-router";
import AppNavbar from "./components/AppNavbar.vue";
import AppFooter from "./components/HomeFooter.vue";
import BottomTabBar from "./components/BottomTabBar.vue";
import { checkLogin } from "./utils/cloudbase.js";

const isLoading = ref(true);

onMounted(async () => {
  try {
    console.log("开始检查登录态...");
    await checkLogin();
    console.log("检查登录态成功");
  } catch (error) {
    console.error("检查登录态失败", error);
  } finally {
    isLoading.value = false;
  }
});
</script>

<style>
/* 页面切换动画 */
.page-enter-active,
.page-leave-active {
  transition: all 0.2s ease;
}
.page-enter-from {
  opacity: 0;
  transform: translateX(10px);
}
.page-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

/* iOS 安全区域 */
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
</style>
