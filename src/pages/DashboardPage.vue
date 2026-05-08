<template>
  <div class="container mx-auto px-4 py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-900 dark:text-white">房屋租赁管理系统</h1>
      <p class="text-gray-600 dark:text-gray-400 mt-2">管理您的房屋、租客和缴费记录</p>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 border-l-4 border-blue-500">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-gray-500 dark:text-gray-400 text-sm">房屋总数</p>
            <p class="text-2xl font-bold text-gray-900 dark:text-white mt-1">{{ stats.houses }}</p>
          </div>
          <div class="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-full">
            <svg class="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </div>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 border-l-4 border-green-500">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-gray-500 dark:text-gray-400 text-sm">活跃租客</p>
            <p class="text-2xl font-bold text-gray-900 dark:text-white mt-1">{{ stats.activeTenants }}</p>
          </div>
          <div class="p-3 bg-green-100 dark:bg-green-900/30 rounded-full">
            <svg class="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 border-l-4 border-yellow-500">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-gray-500 dark:text-gray-400 text-sm">本月收入</p>
            <p class="text-2xl font-bold text-gray-900 dark:text-white mt-1">¥{{ stats.monthlyIncome }}</p>
          </div>
          <div class="p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-full">
            <svg class="w-6 h-6 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 border-l-4 border-red-500">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-gray-500 dark:text-gray-400 text-sm">待缴费用</p>
            <p class="text-2xl font-bold text-gray-900 dark:text-white mt-1">¥{{ stats.pendingPayments }}</p>
          </div>
          <div class="p-3 bg-red-100 dark:bg-red-900/30 rounded-full">
            <svg class="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <!-- 收费提醒 -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-8">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold text-gray-900 dark:text-white">临近收费提醒</h2>
        <span class="text-sm text-gray-500 dark:text-gray-400">含逾期账单及未来3天内需收费的房屋</span>
      </div>

      <div v-if="upcomingRentHouses.length === 0" class="text-center py-8">
        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 class="mt-2 text-sm font-medium text-gray-900 dark:text-white">暂无临近收费</h3>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">已到期及未来3天内没有需要收费的房屋</p>
      </div>

      <div v-else class="space-y-4">
        <div v-for="house in upcomingRentHouses" :key="house.houseId" class="p-4 rounded-lg border" :class="[
          house.overdueItems.length > 0 ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' :
          house.upcomingItem ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800' :
          'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
        ]">
          <!-- 标题行 -->
          <div class="flex items-center mb-1">
            <span class="text-base font-bold text-gray-900 dark:text-white">{{ house.houseCode }} - {{ house.houseAddress }}</span>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">
            租客: {{ house.tenantName }} ｜ 月租: ¥{{ house.monthlyRent }}
          </p>

          <!-- 正常到期提醒 -->
          <template v-if="!house.overdueItems.length && house.upcomingItem">
            <div class="text-sm text-yellow-700 dark:text-yellow-300">
              <span class="font-medium">📅 {{ formatDate(house.upcomingItem.dueDate) }}</span>
              <span class="ml-1">到期需交租 ¥{{ house.upcomingItem.amount?.toFixed(2) }}</span>
              <span class="ml-1 text-yellow-500">（还有{{ house.upcomingItem.daysUntilDue }}天）</span>
            </div>
          </template>

          <!-- 逾期情况 -->
          <template v-if="house.overdueItems.length > 0">
            <!-- 大白话说明 -->
            <div class="text-sm text-red-700 dark:text-red-300 mb-3 leading-relaxed">
              <p><span class="font-medium">上次缴费:</span> {{ formatDate(house.lastPaymentDate) }}（{{ house.cycleLabel }}¥{{ house.cycleAmount }}）</p>
              <p><span class="font-medium">正常能住到:</span> {{ formatDate(house.overdueItems[0]?.dueDate) }}</p>
              <p class="mt-1">
                <span class="font-medium">⚠️ 从那天起就没再交租了，到目前已拖了</span>
                <span class="text-red-600 font-bold text-base">{{ house.overdueItems[0]?.daysOverdue }}天</span>
              </p>
            </div>

            <!-- 欠费明细表 -->
            <div class="bg-red-100/60 dark:bg-red-900/15 rounded p-2 mb-1">
              <p class="text-xs font-medium text-red-600 dark:text-red-400 mb-1">📋 欠费明细</p>
              <div v-for="(item, idx) in house.overdueItems" :key="idx" class="flex justify-between items-center text-sm py-1">
                <span class="text-red-700 dark:text-red-300">{{ formatDate(item.dueDate) }} 到期</span>
                <span class="font-bold text-red-700 dark:text-red-300">¥{{ item.amount?.toFixed(2) }}</span>
              </div>
              <!-- 即将到来的跳费 -->
              <div v-if="house.upcomingItem" class="flex justify-between items-center text-sm py-1 border-t border-red-200 dark:border-red-700 mt-1 pt-1">
                <span class="text-red-500 dark:text-red-400">{{ formatDate(house.upcomingItem.dueDate) }} 到期（{{ house.upcomingItem.daysUntilDue }}天后）</span>
                <span class="text-red-500 dark:text-red-400">¥{{ house.upcomingItem.amount?.toFixed(2) }}</span>
              </div>
            </div>

            <!-- 总计 -->
            <div class="flex justify-between items-center">
              <span class="text-sm font-bold text-red-700 dark:text-red-300">
                共欠 <span class="text-lg">{{ house.overdueItems.length }}期</span>
              </span>
              <span class="text-lg font-bold text-red-700 dark:text-red-300">¥{{ house.totalOverdue?.toFixed(2) }}</span>
            </div>
            <p v-if="house.upcomingItem" class="text-xs text-red-500 dark:text-red-400 mt-1">
              ⏰ {{ formatDate(house.upcomingItem.dueDate) }} 再不加又要多欠¥{{ house.upcomingItem.amount?.toFixed(2) }}
            </p>
          </template>
        </div>
      </div>
    </div>

    <!-- 快速操作 -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-4">快速操作</h2>
        <div class="grid grid-cols-2 gap-4">
          <router-link to="/houses" class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition">
            <div class="flex items-center">
              <svg class="w-5 h-5 text-blue-600 dark:text-blue-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <span class="font-medium text-blue-700 dark:text-blue-300">管理房屋</span>
            </div>
          </router-link>

          <router-link to="/tenants" class="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30 transition">
            <div class="flex items-center">
              <svg class="w-5 h-5 text-green-600 dark:text-green-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span class="font-medium text-green-700 dark:text-green-300">管理租客</span>
            </div>
          </router-link>

          <router-link to="/payments" class="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition">
            <div class="flex items-center">
              <svg class="w-5 h-5 text-yellow-600 dark:text-yellow-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span class="font-medium text-yellow-700 dark:text-yellow-300">缴费记录</span>
            </div>
          </router-link>

          <router-link to="/utility" class="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition">
            <div class="flex items-center">
              <svg class="w-5 h-5 text-purple-600 dark:text-purple-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span class="font-medium text-purple-700 dark:text-purple-300">水电费计算</span>
            </div>
          </router-link>
        </div>
      </div>

      <!-- 最近活动 -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-4">最近活动</h2>
        <div class="space-y-4">
          <div v-for="activity in recentActivities" :key="activity.id" class="flex items-start p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <div :class="['p-2 rounded-full mr-3', activity.type === 'payment' ? 'bg-green-100 dark:bg-green-900/30' : activity.type === 'tenant' ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-yellow-100 dark:bg-yellow-900/30']">
              <svg v-if="activity.type === 'payment'" class="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <svg v-else-if="activity.type === 'tenant'" class="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <svg v-else class="w-4 h-4 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div class="flex-1">
              <p class="text-sm font-medium text-gray-900 dark:text-white">{{ activity.title }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ activity.time }}</p>
            </div>
            <span :class="['text-xs font-medium px-2 py-1 rounded-full', activity.status === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300']">
              {{ activity.status === 'success' ? '完成' : '待处理' }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { dbService } from '../lib/database'

const stats = ref({
  houses: 0,
  activeTenants: 0,
  monthlyIncome: 0,
  pendingPayments: 0
})

const recentActivities = ref<any[]>([])
const upcomingRentHouses = ref<any[]>([])

// 计算相对时间
const getRelativeTime = (date: Date): string => {
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) return '刚刚'
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}分钟前`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}小时前`
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}天前`
  return '较久前'
}

// 格式化日期
const formatDate = (date: Date | string) => {
  if (!date) return '未设置'
  return new Date(date).toLocaleDateString('zh-CN')
}

const loadRecentActivities = async () => {
  try {
    const activities: any[] = []

    // 获取最近房屋
    const housesResult = await dbService.getHouses()
    const recentHouses = housesResult.data.slice(0, 3) // 最近3个房屋
    recentHouses.forEach(house => {
      const createdAt = new Date(house.createdAt)
      activities.push({
        id: `house_${house._id}`,
        type: 'house',
        title: `新增房屋 ${house.code || ''} - ${house.address}`,
        time: getRelativeTime(createdAt),
        timestamp: createdAt,
        status: 'success'
      })
    })

    // 获取最近租客
    const tenantsResult = await dbService.getTenants()
    const recentTenants = tenantsResult.data.slice(0, 3) // 最近3个租客
    recentTenants.forEach(tenant => {
      const createdAt = new Date(tenant.createdAt)
      const statusText = tenant.status === 'active' ? '入住' : '退租'
      activities.push({
        id: `tenant_${tenant._id}`,
        type: 'tenant',
        title: `${tenant.name} 办理了${statusText}手续`,
        time: getRelativeTime(createdAt),
        timestamp: createdAt,
        status: tenant.status === 'active' ? 'success' : 'success'
      })
    })

    // 获取最近缴费记录
    const paymentsResult = await dbService.getPayments()
    const recentPayments = paymentsResult.data.slice(0, 3) // 最近3个缴费
    recentPayments.forEach(payment => {
      const paymentDate = new Date(payment.paymentDate || payment.createdAt)
      const paymentTypes: Record<string, string> = {
        'rent': '租金',
        'utility': '水电费',
        'deposit': '押金',
        'other': '其他费用'
      }
      const typeText = paymentTypes[payment.paymentType] || payment.paymentType
      activities.push({
        id: `payment_${payment._id}`,
        type: 'payment',
        title: `${payment.description || `${typeText} ${payment.amount}元`}`,
        time: getRelativeTime(paymentDate),
        timestamp: paymentDate,
        status: payment.status === 'paid' ? 'success' : 'pending'
      })
    })

    // 获取最近水电记录
    const utilityResult = await dbService.getUtilityRecords()
    const recentUtilities = utilityResult.data.slice(0, 3) // 最近3个水电记录
    recentUtilities.forEach(record => {
      const calculationDate = new Date(record.calculationDate || record.createdAt)
      activities.push({
        id: `utility_${record._id}`,
        type: 'payment',
        title: `水电费计算 ${record.totalCost}元`,
        time: getRelativeTime(calculationDate),
        timestamp: calculationDate,
        status: 'success'
      })
    })

    // 按时间戳排序，取最近10个
    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    recentActivities.value = activities.slice(0, 10)

  } catch (error) {
    console.error('加载最近活动失败:', error)
  }
}

// 加载统计数据
const loadStats = async () => {
  try {
    const houses = await dbService.getHouses()
    const tenants = await dbService.getTenants({ status: 'active' })
    const payments = await dbService.getPayments()

    stats.value.houses = houses.data.length
    stats.value.activeTenants = tenants.data.length

    // 计算本月收入（已缴费用）
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()

    const monthlyIncome = payments.data
      .filter(p => {
        const date = new Date(p.paymentDate || p.createdAt)
        return date.getMonth() === currentMonth &&
               date.getFullYear() === currentYear &&
               p.status === 'paid'
      })
      .reduce((sum, p) => sum + (p.amount || 0), 0)

    stats.value.monthlyIncome = monthlyIncome

    // 计算待缴费用（来自缴费记录中标记为待缴/逾期的）
    const pendingPayments = payments.data
      .filter(p => p.status === 'pending' || p.status === 'overdue')
      .reduce((sum, p) => sum + (p.amount || 0), 0)

    stats.value.pendingPayments = pendingPayments

  } catch (error) {
    console.error('加载统计数据失败:', error)
  }
}

// 加载收费提醒后，同步将逾期总额计入待缴费用
const loadUpcomingRentHouses = async () => {
  try {
    const houses = await dbService.getUpcomingRentHouses(3)
    upcomingRentHouses.value = houses
    // 把动态计算的逾期总额加到待缴费用中
    const overdueTotal = houses.reduce((sum: number, h: any) => sum + (h.totalOverdue || 0), 0)
    if (overdueTotal > 0) {
      stats.value.pendingPayments += overdueTotal
    }
  } catch (error) {
    console.error('加载临近收费房屋失败:', error)
  }
}

onMounted(async () => {
  await loadStats()
  await loadRecentActivities()
  await loadUpcomingRentHouses()
})
</script>