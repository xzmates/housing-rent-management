<template>
  <header class="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
    <nav class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-1">
          <RouterLink to="/dashboard" class="text-lg font-bold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition mr-6">
            🏠 房租管理
          </RouterLink>

          <div class="flex items-center space-x-1">
            <RouterLink v-for="item in navItems" :key="item.path" :to="item.path"
              class="px-3 py-2 text-sm font-medium rounded-lg transition"
              :class="isActive(item.path)
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                : 'text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700'">
              {{ item.label }}
            </RouterLink>
          </div>
        </div>

        <button @click="toggleDarkMode" class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition">
          <svg v-if="isDarkMode" class="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <svg v-else class="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        </button>
      </div>
    </nav>
  </header>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { RouterLink } from "vue-router"

const route = useRoute()
const isDarkMode = ref(false)

const navItems = [
  { path: '/dashboard', label: '仪表盘' },
  { path: '/houses', label: '房屋管理' },
  { path: '/tenants', label: '租客管理' },
  { path: '/payments', label: '缴费记录' },
  { path: '/utility', label: '水电费' },
  { path: '/settings', label: '系统设置' },
]

const isActive = (path: string) => route.path.startsWith(path)

const toggleDarkMode = () => {
  isDarkMode.value = !isDarkMode.value
  document.documentElement.classList.toggle('dark', isDarkMode.value)
  localStorage.setItem('color-theme', isDarkMode.value ? 'dark' : 'light')
}

onMounted(() => {
  const stored = localStorage.getItem('color-theme')
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  isDarkMode.value = stored === 'dark' || (!stored && prefersDark)
  document.documentElement.classList.toggle('dark', isDarkMode.value)
})
</script>
