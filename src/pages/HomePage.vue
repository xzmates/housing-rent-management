<template>
  <div class="container mx-auto max-w-6xl px-4 py-16">
    <div class="text-center">
      <h1 class="mb-4 text-4xl font-bold text-gray-900 dark:text-white">房屋租赁管理系统</h1>
      <p class="mb-8 text-lg text-gray-600 dark:text-gray-400">基于CloudBase云开发的一站式租赁管理解决方案</p>

      <div v-if="loading" class="text-center py-8">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <p class="mt-2">检查登录状态中...</p>
      </div>

      <!-- 功能卡片网格 -->
      <div v-if="isLoggedIn" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <RouterLink to="/dashboard" class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow border border-gray-200 dark:border-gray-700">
          <div class="flex items-center mb-4">
            <div class="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg mr-4">
              <svg class="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">数据仪表盘</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">查看系统概览和统计数据</p>
            </div>
          </div>
        </RouterLink>

        <RouterLink to="/houses" class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow border border-gray-200 dark:border-gray-700">
          <div class="flex items-center mb-4">
            <div class="p-3 bg-green-100 dark:bg-green-900/30 rounded-lg mr-4">
              <svg class="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">房屋管理</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">添加、编辑和筛选房屋信息</p>
            </div>
          </div>
        </RouterLink>

        <RouterLink to="/tenants" class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow border border-gray-200 dark:border-gray-700">
          <div class="flex items-center mb-4">
            <div class="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg mr-4">
              <svg class="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">租客管理</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">管理租客信息和退租操作</p>
            </div>
          </div>
        </RouterLink>

        <RouterLink to="/payments" class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow border border-gray-200 dark:border-gray-700">
          <div class="flex items-center mb-4">
            <div class="p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg mr-4">
              <svg class="w-6 h-6 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">缴费记录</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">租金、水电费、押金等缴费管理</p>
            </div>
          </div>
        </RouterLink>

        <RouterLink to="/utility" class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow border border-gray-200 dark:border-gray-700">
          <div class="flex items-center mb-4">
            <div class="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg mr-4">
              <svg class="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">水电费计算</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">自动计算水电费并生成记录</p>
            </div>
          </div>
        </RouterLink>

        <RouterLink to="/settings" class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow border border-gray-200 dark:border-gray-700">
          <div class="flex items-center mb-4">
            <div class="p-3 bg-gray-100 dark:bg-gray-900/30 rounded-lg mr-4">
              <svg class="w-6 h-6 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">系统设置</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">水电单价和系统配置管理</p>
            </div>
          </div>
        </RouterLink>
      </div>

      <!-- 登录状态卡片 -->
      <div class="max-w-md mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <div class="mb-6">
          <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">登录状态</h2>
          <div class="flex items-center justify-between">
            <div>
              <span class="font-medium text-gray-700 dark:text-gray-300">环境ID:</span>
              <span class="ml-2 text-sm font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-gray-900 dark:text-white">{{ envId }}</span>
            </div>
            <div :class="['px-3 py-1 rounded-full text-sm font-medium', isLoggedIn ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300']">
              {{ isLoggedIn ? '已登录' : '未登录' }}
            </div>
          </div>
        </div>

        <div v-if="loginResult" class="mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded">
          <h3 class="font-medium text-gray-900 dark:text-white mb-2">登录信息</h3>
          <pre class="text-xs overflow-auto p-2 bg-gray-100 dark:bg-gray-800 rounded text-gray-900 dark:text-white">{{ JSON.stringify(loginResult, null, 2) }}</pre>
        </div>

        <div class="flex flex-col gap-3">
          <button
            @click="checkLoginStatus"
            class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
            :disabled="loading"
          >
            检查登录状态
          </button>

          <button
            v-if="isLoggedIn"
            @click="handleLogout"
            class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
            :disabled="loading"
          >
            退出登录
          </button>

          <div v-if="error" class="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
            <p class="text-red-600 dark:text-red-400 text-sm">{{ error }}</p>
          </div>

          <div v-if="!envValid" class="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded">
            <p class="text-yellow-600 dark:text-yellow-400 text-sm">
              ⚠️ 环境ID未配置或无效，请检查.env文件配置
            </p>
          </div>
        </div>

        <div v-if="isLoggedIn" class="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
          <h3 class="font-medium text-gray-900 dark:text-white mb-2">使用说明</h3>
          <ul class="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <li>1. 环境ID: {{ envId }}</li>
            <li>2. 登录方式: 匿名登录（无需配置）</li>
            <li>3. 使用上方的功能卡片开始管理系统</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { checkLogin, logout, checkEnvironment, isValidEnvId as envValid } from '../utils/cloudbase'

const loading = ref(false)
const isLoggedIn = ref(false)
const loginResult = ref<any>(null)
const error = ref('')
const envId = import.meta.env.VITE_ENV_ID || '未配置'

const checkLoginStatus = async () => {
  loading.value = true
  error.value = ''

  try {
    // 检查环境配置
    if (!checkEnvironment()) {
      error.value = '环境配置无效，请检查.env文件'
      loading.value = false
      return
    }

    const result = await checkLogin()
    loginResult.value = result
    isLoggedIn.value = result.isLoggedIn

  } catch (err: any) {
    error.value = err.message || '检查登录状态失败'
    console.error('登录检查错误:', err)
  } finally {
    loading.value = false
  }
}

const handleLogout = async () => {
  loading.value = true
  error.value = ''

  try {
    const result = await logout()
    alert(result.message)
    isLoggedIn.value = false
    loginResult.value = null
  } catch (err: any) {
    error.value = err.message || '退出登录失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  checkLoginStatus()
})
</script>
