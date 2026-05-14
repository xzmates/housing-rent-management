<template>
  <div class="px-4 py-5 max-w-lg mx-auto md:max-w-6xl space-y-5">
    <!-- 头部 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-gray-900 dark:text-white">房屋租赁管理</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">管理您的房屋、租客和缴费记录</p>
      </div>
    </div>

    <!-- 统计卡片：2x2 网格 -->
    <div class="grid grid-cols-2 gap-3">
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">房屋总数</p>
            <p class="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">{{ stats.houses }}</p>
          </div>
          <div class="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
          </div>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">活跃租客</p>
            <p class="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">{{ stats.activeTenants }}</p>
          </div>
          <div class="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 dark:text-green-400">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">本月收入</p>
            <p class="text-2xl font-bold text-green-600 dark:text-green-400 mt-0.5">¥{{ stats.monthlyIncome }}</p>
          </div>
          <div class="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center text-yellow-600 dark:text-yellow-400">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">待缴费用</p>
            <p class="text-2xl font-bold text-red-600 dark:text-red-400 mt-0.5">¥{{ stats.pendingPayments }}</p>
          </div>
          <div class="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
        </div>
      </div>
    </div>

    <!-- 收费提醒 -->
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <div class="flex items-center justify-between">
          <h2 class="font-bold text-gray-900 dark:text-white">收费提醒</h2>
          <span class="text-xs text-gray-500 dark:text-gray-400">含逾期及未来10天</span>
        </div>
      </div>

      <div v-if="upcomingRentHouses.length === 0" class="px-4 py-8 text-center">
        <svg class="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">暂无收费提醒</p>
      </div>

      <div v-else class="divide-y divide-gray-100 dark:divide-gray-700">
        <div v-for="house in upcomingRentHouses" :key="house.houseId" class="px-4 py-4" :class="house.overdueItems.length > 0 ? 'bg-red-50/50 dark:bg-red-900/10' : 'bg-yellow-50/50 dark:bg-yellow-900/10'">
          <!-- 标题行 -->
          <div class="flex items-center justify-between mb-1">
            <div class="flex items-center gap-2">
              <span :class="house.overdueItems.length > 0 ? 'w-2 h-2 rounded-full bg-red-500' : 'w-2 h-2 rounded-full bg-yellow-500'"></span>
              <span class="font-medium text-sm text-gray-900 dark:text-white">{{ house.houseCode }}<span class="font-normal text-gray-500 dark:text-gray-400"> - {{ house.houseAddress }}</span></span>
            </div>
            <span class="text-xs text-gray-500 dark:text-gray-400">{{ house.tenantName }} · ¥{{ house.monthlyRent }}/月</span>
          </div>

          <!-- 正常到期提醒 -->
          <template v-if="!house.overdueItems.length && house.upcomingItem">
            <p class="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
              已覆盖到 <strong>{{ formatCoverageDate(house.rentCoveredUntil) }}</strong>
            </p>
            <p class="text-sm text-yellow-700 dark:text-yellow-300">
              {{ formatDate(house.upcomingItem.dueDate) }} 需交租 ¥{{ house.upcomingItem.amount?.toFixed(1) }}
              <span class="text-yellow-500" v-if="house.upcomingItem.daysUntilDue > 0">（{{ house.upcomingItem.daysUntilDue }}天后）</span>
              <span class="text-yellow-500" v-else-if="house.upcomingItem.daysUntilDue === 0">（今天）</span>
            </p>
          </template>

          <!-- 逾期 -->
          <template v-if="house.overdueItems.length > 0">
            <div class="text-sm text-red-700 dark:text-red-300 mt-1 leading-relaxed">
              <p>已覆盖到 <strong>{{ formatCoverageDate(house.rentCoveredUntil) }}</strong>（<span class="text-base font-medium">已逾期 {{ house.overdueItems[0]?.daysOverdue }}天</span>）</p>
              <p class="text-xs text-red-500/70">下次缴费: {{ formatDate(house.nextDueDate) }} · {{ house.cycleLabel }}</p>
            </div>
            <div class="mt-2 bg-red-100/60 dark:bg-red-900/20 rounded-lg p-2.5">
              <div class="flex justify-between items-center text-sm" v-for="(item, idx) in house.overdueItems" :key="idx">
                <span class="text-red-700 dark:text-red-300">{{ formatDate(item.dueDate) }}</span>
                <span class="font-bold text-red-700 dark:text-red-300">¥{{ item.amount?.toFixed(1) }}</span>
              </div>
              <div v-if="house.upcomingItem" class="flex justify-between items-center text-sm mt-1.5 pt-1.5 border-t border-red-200 dark:border-red-700">
                <span class="text-red-500 dark:text-red-400 text-xs">{{ formatDate(house.upcomingItem.dueDate) }} 再到期</span>
                <span class="text-red-500 dark:text-red-400 text-xs font-medium">+¥{{ house.upcomingItem.amount?.toFixed(1) }}</span>
              </div>
            </div>
            <div class="flex justify-between items-center mt-2">
              <span class="text-sm font-bold text-red-700 dark:text-red-300">共欠 {{ house.overdueItems.length }} 期</span>
              <span class="text-base font-bold text-red-700 dark:text-red-300">¥{{ house.totalOverdue?.toFixed(1) }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 快捷操作 -->
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
      <h2 class="font-bold text-gray-900 dark:text-white mb-3">快捷操作</h2>
      <div class="grid grid-cols-4 gap-2">
        <RouterLink to="/houses" class="flex flex-col items-center gap-1 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 active:scale-95 transition-transform">
          <svg class="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
          <span class="text-xs font-medium text-blue-700 dark:text-blue-300">房屋</span>
        </RouterLink>
        <RouterLink to="/tenants" class="flex flex-col items-center gap-1 p-3 rounded-xl bg-green-50 dark:bg-green-900/20 active:scale-95 transition-transform">
          <svg class="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span class="text-xs font-medium text-green-700 dark:text-green-300">租客</span>
        </RouterLink>
        <RouterLink to="/payments" class="flex flex-col items-center gap-1 p-3 rounded-xl bg-yellow-50 dark:bg-yellow-900/20 active:scale-95 transition-transform">
          <svg class="w-6 h-6 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span class="text-xs font-medium text-yellow-700 dark:text-yellow-300">缴费</span>
        </RouterLink>
        <RouterLink to="/utility" class="flex flex-col items-center gap-1 p-3 rounded-xl bg-purple-50 dark:bg-purple-900/20 active:scale-95 transition-transform">
          <svg class="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          <span class="text-xs font-medium text-purple-700 dark:text-purple-300">水电</span>
        </RouterLink>
      </div>
    </div>

    <!-- 最近活动 -->
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <h2 class="font-bold text-gray-900 dark:text-white">最近活动</h2>
      </div>
      <div v-if="recentActivities.length === 0" class="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">暂无活动</div>
      <div v-else class="divide-y divide-gray-100 dark:divide-gray-700">
        <div v-for="activity in recentActivities" :key="activity.id" class="px-4 py-3 flex items-start gap-3">
          <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0" :class="activity.type === 'payment' ? 'bg-green-100 dark:bg-green-900/30' : activity.type === 'tenant' ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-yellow-100 dark:bg-yellow-900/30'">
            <svg v-if="activity.type === 'payment'" class="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <svg v-else-if="activity.type === 'tenant'" class="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <svg v-else class="w-4 h-4 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ activity.title }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ activity.time }}</p>
          </div>
          <span v-if="activity.status" class="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium" :class="activity.status === 'success' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'">
            {{ activity.status === 'success' ? '完成' : '待处理' }}
          </span>
        </div>
      </div>
    </div>

    <div class="h-4"></div>
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

const getRelativeTime = (date: Date): string => {
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (diffInSeconds < 60) return '刚刚'
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}分钟前`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}小时前`
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}天前`
  return `${Math.floor(diffInSeconds / 2592000)}月前`
}

const formatDate = (date: Date | string) => {
  if (!date) return '未设置'
  return new Date(date).toLocaleDateString('zh-CN')
}

const formatCoverageDate = (date: Date | string | undefined | null) => {
  if (!date) return '—'
  const d = new Date(date)
  return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`
}

const loadUpcomingRentHouses = async () => {
  try {
    const houses = await dbService.getUpcomingRentHouses(10)
    upcomingRentHouses.value = houses
    const overdueTotal = houses.reduce((sum: number, h: any) => sum + (h.totalOverdue || 0), 0)
    if (overdueTotal > 0) {
      stats.value.pendingPayments += overdueTotal
    }
  } catch (error) {
    console.error('加载临近收费房屋失败:', error)
  }
}

const loadRecentActivities = async () => {
  try {
    const activities: any[] = []

    const housesResult = await dbService.getHouses()
    const recentHouses = housesResult.data.slice(0, 3)
    recentHouses.forEach((house: any) => {
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

    const tenantsResult = await dbService.getTenants()
    const recentTenants = tenantsResult.data.slice(0, 3)
    recentTenants.forEach((tenant: any) => {
      const createdAt = new Date(tenant.createdAt)
      activities.push({
        id: `tenant_${tenant._id}`,
        type: 'tenant',
        title: `${tenant.name} ${tenant.status === 'active' ? '入住' : '退租'}`,
        time: getRelativeTime(createdAt),
        timestamp: createdAt,
        status: 'success'
      })
    })

    const paymentsResult = await dbService.getPayments()
    const recentPayments = paymentsResult.data.slice(0, 3)
    recentPayments.forEach((payment: any) => {
      const paymentDate = new Date(payment.paymentDate || payment.createdAt)
      activities.push({
        id: `payment_${payment._id}`,
        type: 'payment',
        title: `${payment.description || '缴费'} ¥${payment.amount}`,
        time: getRelativeTime(paymentDate),
        timestamp: paymentDate,
        status: payment.status === 'paid' ? 'success' : 'pending'
      })
    })

    const utilityResult = await dbService.getUtilityRecords()
    const recentUtilities = utilityResult.data.slice(0, 3)
    recentUtilities.forEach((record: any) => {
      const calculationDate = new Date(record.calculationDate || record.createdAt)
      activities.push({
        id: `utility_${record._id}`,
        type: 'payment',
        title: `水电费 ¥${record.totalCost}`,
        time: getRelativeTime(calculationDate),
        timestamp: calculationDate,
        status: 'success'
      })
    })

    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    recentActivities.value = activities.slice(0, 10)
  } catch (error) {
    console.error('加载最近活动失败:', error)
  }
}

const loadStats = async () => {
  try {
    const houses = await dbService.getHouses()
    const tenants = await dbService.getTenants({ status: 'active' })
    const payments = await dbService.getPayments()

    stats.value.houses = houses.data.length
    stats.value.activeTenants = tenants.data.length

    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()

    stats.value.monthlyIncome = payments.data
      .filter((p: any) => {
        const date = new Date(p.paymentDate || p.createdAt)
        return date.getMonth() === currentMonth && date.getFullYear() === currentYear && p.status === 'paid'
      })
      .reduce((sum: number, p: any) => sum + (p.amount || 0), 0)

    stats.value.pendingPayments = payments.data
      .filter((p: any) => p.status === 'pending' || p.status === 'overdue')
      .reduce((sum: number, p: any) => sum + (p.amount || 0), 0)
  } catch (error) {
    console.error('加载统计数据失败:', error)
  }
}

onMounted(async () => {
  await loadStats()
  await loadRecentActivities()
  await loadUpcomingRentHouses()
})
</script>
