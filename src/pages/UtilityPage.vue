<template>
  <div class="container mx-auto px-4 py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-900 dark:text-white">水电费计算</h1>
      <p class="text-gray-600 dark:text-gray-400 mt-2">自动计算水电费并生成缴费记录</p>
    </div>

    <!-- 当前系统设置 -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-8">
      <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-4">当前单价设置</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-gray-500 dark:text-gray-400 text-sm">电费单价</p>
              <p class="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">¥{{ settings.electricityPrice }}/度</p>
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
              <p class="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">¥{{ settings.waterPrice }}/吨</p>
            </div>
            <div class="p-3 bg-green-100 dark:bg-green-900/30 rounded-full">
              <svg class="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
          </div>
        </div>
      </div>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-4">如需修改单价，请前往 <router-link to="/settings" class="text-blue-600 dark:text-blue-400 hover:underline">系统设置</router-link></p>
    </div>

    <!-- 水电费计算表单 -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-8">
      <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-4">计算水电费</h2>

      <form @submit.prevent="calculateBill">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">选择房屋</label>
            <select v-model="form.houseId" required @change="loadTenantsForHouse" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              <option value="">请选择房屋</option>
              <option v-for="house in availableHouses" :key="house._id" :value="house._id">
                {{ house.code }} - {{ house.address }}
              </option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">选择租客</label>
            <select v-model="form.tenantId" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              <option value="">请选择租客</option>
              <option v-for="tenant in availableTenants" :key="tenant._id" :value="tenant._id">
                {{ tenant.name }}
              </option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">当前电表读数（度）</label>
            <input v-model="form.currentElectricity" type="number" step="0.01" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">上次读数: {{ lastReading?.electricityReading || 0 }} 度</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">当前水表读数（吨）</label>
            <input v-model="form.currentWater" type="number" step="0.01" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">上次读数: {{ lastReading?.waterReading || 0 }} 吨</p>
          </div>
        </div>

        <div class="flex justify-end">
          <button type="submit" :disabled="calculating" class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center">
            <svg v-if="calculating" class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            {{ calculating ? '计算中...' : '计算水电费' }}
          </button>
        </div>
      </form>
    </div>

    <!-- 计算结果 -->
    <div v-if="calculationResult" class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-4">计算结果</h2>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <div class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <p class="text-gray-500 dark:text-gray-400 text-sm">用电量</p>
          <p class="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">{{ calculationResult.electricityUsage }} 度</p>
        </div>

        <div class="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <p class="text-gray-500 dark:text-gray-400 text-sm">用水量</p>
          <p class="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">{{ calculationResult.waterUsage }} 吨</p>
        </div>

        <div class="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
          <p class="text-gray-500 dark:text-gray-400 text-sm">电费</p>
          <p class="text-2xl font-bold text-yellow-600 dark:text-yellow-400 mt-1">¥{{ calculationResult.electricityCost }}</p>
        </div>

        <div class="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
          <p class="text-gray-500 dark:text-gray-400 text-sm">水费</p>
          <p class="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">¥{{ calculationResult.waterCost }}</p>
        </div>
      </div>

      <div class="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg mb-6">
        <div class="flex justify-between items-center">
          <div>
            <p class="text-gray-500 dark:text-gray-400 text-sm">总费用</p>
            <p class="text-3xl font-bold text-gray-900 dark:text-white mt-1">¥{{ calculationResult.totalCost }}</p>
          </div>
          <div class="p-3 bg-green-100 dark:bg-green-900/30 rounded-full">
            <svg class="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>

      <div class="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
        <div class="flex items-center">
          <svg class="w-5 h-5 text-green-600 dark:text-green-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          <p class="text-green-700 dark:text-green-300">水电费计算完成！已自动生成缴费记录。</p>
        </div>
        <p class="text-sm text-green-600 dark:text-green-400 mt-2">您可以在 <router-link to="/payments" class="font-medium underline">缴费记录</router-link> 页面查看详情。</p>
      </div>
    </div>

    <!-- 最近水电记录 -->
    <div class="mt-8">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold text-gray-900 dark:text-white">最近水电记录</h2>
        <button @click="loadUtilityRecords" class="text-sm text-blue-600 dark:text-blue-400 hover:underline">刷新</button>
      </div>

      <div v-if="utilityRecordsLoading" class="text-center py-8">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <p class="mt-2 text-gray-600 dark:text-gray-400">加载中...</p>
      </div>

      <div v-else-if="utilityRecords.length === 0" class="text-center py-8 bg-white dark:bg-gray-800 rounded-lg shadow-md">
        <p class="text-gray-500 dark:text-gray-400">暂无水电记录</p>
      </div>

      <div v-else class="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead class="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">房屋/租客</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">用电量</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">用水量</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">总费用</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">计算日期</th>
            </tr>
          </thead>
          <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-for="record in utilityRecords" :key="record._id">
              <td class="px-6 py-4">
                <div class="text-sm font-medium text-gray-900 dark:text-white">{{ getHouseAddress(record.houseId) }}</div>
                <div class="text-sm text-gray-500 dark:text-gray-400">{{ getTenantName(record.tenantId) }}</div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm text-gray-900 dark:text-white">{{ record.electricityUsage }} 度</div>
                <div class="text-xs text-gray-500 dark:text-gray-400">¥{{ record.electricityCost }}</div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm text-gray-900 dark:text-white">{{ record.waterUsage }} 吨</div>
                <div class="text-xs text-gray-500 dark:text-gray-400">¥{{ record.waterCost }}</div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-lg font-bold text-gray-900 dark:text-white">¥{{ record.totalCost }}</div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm text-gray-900 dark:text-white">{{ formatDate(record.calculationDate) }}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { dbService } from '../lib/database'

interface House {
  _id: string
  code: string
  address: string
}

interface Tenant {
  _id: string
  name: string
  houseId: string
}

interface UtilityRecord {
  _id: string
  houseId: string
  tenantId: string
  electricityReading: number
  waterReading: number
  electricityUsage: number
  waterUsage: number
  electricityCost: number
  waterCost: number
  totalCost: number
  calculationDate: Date
}

interface Settings {
  electricityPrice: number
  waterPrice: number
}

const calculating = ref(false)
const utilityRecordsLoading = ref(false)

const availableHouses = ref<House[]>([])
const availableTenants = ref<Tenant[]>([])
const utilityRecords = ref<UtilityRecord[]>([])
const settings = ref<Settings>({ electricityPrice: 0.8, waterPrice: 3.5 })
const lastReading = ref<UtilityRecord | null>(null)
const calculationResult = ref<any>(null)

const form = ref({
  houseId: '',
  tenantId: '',
  currentElectricity: 0,
  currentWater: 0
})

const loadSettings = async () => {
  try {
    const result = await dbService.getSystemSettings()
    if (result.data.length > 0) {
      settings.value = result.data[0]
    }
  } catch (error) {
    console.error('加载系统设置失败:', error)
  }
}

const loadHouses = async () => {
  try {
    const result = await dbService.getHouses()
    availableHouses.value = result.data
  } catch (error) {
    console.error('加载房屋失败:', error)
  }
}

const loadTenantsForHouse = async () => {
  if (!form.value.houseId) {
    availableTenants.value = []
    return
  }

  try {
    const result = await dbService.getTenants({
      houseId: form.value.houseId,
      status: 'active'
    })
    availableTenants.value = result.data

    // 加载上一次的水电记录
    if (form.value.tenantId) {
      loadLastReading()
    }
  } catch (error) {
    console.error('加载租客失败:', error)
  }
}

const loadLastReading = async () => {
  if (!form.value.houseId || !form.value.tenantId) return

  try {
    const result = await dbService.getUtilityRecords({
      houseId: form.value.houseId,
      tenantId: form.value.tenantId
    })

    if (result.data.length > 0) {
      lastReading.value = result.data[0]
      // 自动填充当前读数为上次读数
      form.value.currentElectricity = lastReading.value?.electricityReading || 0
      form.value.currentWater = lastReading.value?.waterReading || 0
    } else {
      lastReading.value = null
    }
  } catch (error) {
    console.error('加载上次读数失败:', error)
  }
}

const loadUtilityRecords = async () => {
  utilityRecordsLoading.value = true
  try {
    const result = await dbService.getUtilityRecords()
    utilityRecords.value = result.data.slice(0, 10) // 只显示最近10条
  } catch (error) {
    console.error('加载水电记录失败:', error)
  } finally {
    utilityRecordsLoading.value = false
  }
}

const calculateBill = async () => {
  calculating.value = true
  try {
    const result = await dbService.calculateUtilityBill(
      form.value.houseId,
      form.value.tenantId,
      Number(form.value.currentElectricity),
      Number(form.value.currentWater)
    )

    calculationResult.value = result
    loadUtilityRecords() // 刷新记录列表

    // 重置表单
    form.value.currentElectricity = 0
    form.value.currentWater = 0

    // 重新加载上次读数
    loadLastReading()

  } catch (error) {
    console.error('计算水电费失败:', error)
    alert('计算失败，请检查输入数据')
  } finally {
    calculating.value = false
  }
}

const getHouseAddress = (houseId: string) => {
  const house = availableHouses.value.find(h => h._id === houseId)
  return house ? `${house.code} - ${house.address}` : '未知房屋'
}

const getTenantName = (tenantId: string) => {
  const tenant = availableTenants.value.find(t => t._id === tenantId)
  return tenant ? tenant.name : '未知租客'
}

const formatDate = (date: Date | string) => {
  if (!date) return '未设置'
  return new Date(date).toLocaleDateString('zh-CN')
}

onMounted(() => {
  loadSettings()
  loadHouses()
  loadUtilityRecords()
})
</script>