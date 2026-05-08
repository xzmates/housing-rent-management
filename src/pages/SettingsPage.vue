<template>
  <div class="container mx-auto px-4 py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-900 dark:text-white">系统设置</h1>
      <p class="text-gray-600 dark:text-gray-400 mt-2">管理系统配置参数和安全设置</p>
    </div>

    <!-- 水电单价设置 -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-8">
      <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-4">水电单价设置</h2>
      <p class="text-gray-600 dark:text-gray-400 mb-6">设置电费和水费的单价，用于水电费自动计算</p>

      <form @submit.prevent="saveSettings">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">电费单价（元/度）</label>
            <input v-model="settingsForm.electricityPrice" type="number" step="0.01" min="0" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">当前电费单价将影响所有水电费计算</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">水费单价（元/吨）</label>
            <input v-model="settingsForm.waterPrice" type="number" step="0.01" min="0" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">当前水费单价将影响所有水电费计算</p>
          </div>
        </div>

        <div class="flex justify-end">
          <button type="submit" :disabled="saving" class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center">
            <svg v-if="saving" class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            {{ saving ? '保存中...' : '保存设置' }}
          </button>
        </div>
      </form>
    </div>

    <!-- 当前设置显示 -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-8">
      <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-4">当前系统设置</h2>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-gray-500 dark:text-gray-400 text-sm">电费单价</p>
              <p class="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">¥{{ currentSettings.electricityPrice }}/度</p>
            </div>
            <div class="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-full">
              <svg class="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </div>
        </div>

        <div class="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-gray-500 dark:text-gray-400 text-sm">水费单价</p>
              <p class="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">¥{{ currentSettings.waterPrice }}/吨</p>
            </div>
            <div class="p-3 bg-green-100 dark:bg-green-900/30 rounded-full">
              <svg class="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <p class="text-sm text-gray-500 dark:text-gray-400 mt-4">设置更新时间: {{ formatDate(currentSettings.updatedAt) }}</p>
    </div>

    <!-- 密码修改 -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-4">密码修改</h2>
      <p class="text-gray-600 dark:text-gray-400 mb-6">修改系统管理员登录密码</p>

      <div class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
        <div class="flex items-center">
          <svg class="w-5 h-5 text-yellow-600 dark:text-yellow-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p class="text-yellow-700 dark:text-yellow-300">密码修改需要使用CloudBase用户管理功能</p>
        </div>
        <p class="text-sm text-yellow-600 dark:text-yellow-400 mt-2">
          如需修改密码，请前往
          <a :href="`https://tcb.cloud.tencent.com/dev?envId=${envId}#/identity/user-manage`" target="_blank" class="font-medium underline hover:text-yellow-800 dark:hover:text-yellow-300">CloudBase控制台用户管理</a>
          进行操作。
        </p>
      </div>

      <div class="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
        <h3 class="font-medium text-blue-700 dark:text-blue-300 mb-2">关于用户认证</h3>
        <p class="text-sm text-blue-600 dark:text-blue-400">
          本系统使用CloudBase内置用户认证系统，支持多种登录方式（手机号、邮箱、用户名密码、微信、匿名等）。
          用户管理、密码重置等操作需要在CloudBase控制台完成。
        </p>
        <div class="mt-3">
          <a :href="`https://tcb.cloud.tencent.com/dev?envId=${envId}#/identity/login-manage`" target="_blank" class="text-sm text-blue-600 dark:text-blue-400 hover:underline mr-4">登录方式管理</a>
          <a :href="`https://tcb.cloud.tencent.com/dev?envId=${envId}#/identity/user-manage`" target="_blank" class="text-sm text-blue-600 dark:text-blue-400 hover:underline">用户管理</a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { dbService } from '../lib/database'

interface SystemSettings {
  _id?: string
  electricityPrice: number
  waterPrice: number
  updatedAt?: Date
}

const saving = ref(false)
const currentSettings = ref<SystemSettings>({
  electricityPrice: 0.8,
  waterPrice: 3.5,
  updatedAt: new Date()
})

const settingsForm = ref({
  electricityPrice: 0.8,
  waterPrice: 3.5
})

const envId = import.meta.env.VITE_ENV_ID || ''

const loadSettings = async () => {
  try {
    const result = await dbService.getSystemSettings()
    if (result.data.length > 0) {
      const settings = result.data[0]
      currentSettings.value = {
        electricityPrice: settings.electricityPrice || 0.8,
        waterPrice: settings.waterPrice || 3.5,
        updatedAt: settings.updatedAt ? new Date(settings.updatedAt) : new Date()
      }
      settingsForm.value = {
        electricityPrice: settings.electricityPrice || 0.8,
        waterPrice: settings.waterPrice || 3.5
      }
    }
  } catch (error) {
    console.error('加载系统设置失败:', error)
  }
}

const saveSettings = async () => {
  saving.value = true
  try {
    await dbService.updateSystemSettings({
      electricityPrice: Number(settingsForm.value.electricityPrice),
      waterPrice: Number(settingsForm.value.waterPrice)
    })

    // 重新加载设置
    await loadSettings()

    // 显示成功消息
    alert('系统设置已保存！')
  } catch (error) {
    console.error('保存系统设置失败:', error)
    alert('保存失败，请重试')
  } finally {
    saving.value = false
  }
}

const formatDate = (date?: Date | string) => {
  if (!date) return '未设置'
  return new Date(date).toLocaleString('zh-CN')
}

onMounted(() => {
  loadSettings()
})
</script>