<template>
  <div class="container mx-auto px-4 py-8">
    <div class="mb-8">
      <div class="flex justify-between items-center">
        <div>
          <h1 class="text-xl font-bold text-gray-900 dark:text-white">房屋管理</h1>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">共 {{ houses.length }} 套房</p>
        </div>
        <button @click="showAddModal = true" class="flex items-center gap-1.5 px-5 py-3 bg-blue-600 text-white rounded-xl font-medium shadow-lg shadow-blue-200/50 dark:shadow-blue-900/30 active:scale-95 transition-all">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
          </svg>
          添加房屋
        </button>
      </div>
    </div>

    <!-- App风格筛选器 -->
    <div class="flex items-center gap-2 overflow-x-auto mb-4 pb-1 scrollbar-hide">
      <button @click="filters.status = ''; loadHouses()" class="shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-colors" :class="!filters.status ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'">
        全部
      </button>
      <button @click="filters.status = 'available'; loadHouses()" class="shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-colors" :class="filters.status === 'available' ? 'bg-green-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'">
        可租
      </button>
      <button @click="filters.status = 'rented'; loadHouses()" class="shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-colors" :class="filters.status === 'rented' ? 'bg-blue-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'">
        已租
      </button>
      <div class="flex items-center gap-1 shrink-0">
        <input v-model="filters.minRent" type="number" placeholder="¥最低" class="w-16 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400" @input="loadHouses">
        <span class="text-gray-400">—</span>
        <input v-model="filters.maxRent" type="number" placeholder="¥最高" class="w-16 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400" @input="loadHouses">
      </div>
      <input v-model="filters.code" type="text" placeholder="搜编号" class="w-20 shrink-0 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-full bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400" @input="loadHouses">
      <button @click="resetFilters" class="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
        清空
      </button>
    </div>

    <!-- 房屋列表 -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
      <div v-if="loading" class="p-8 text-center">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <p class="mt-2 text-gray-600 dark:text-gray-400">加载中...</p>
      </div>

      <div v-else-if="houses.length === 0" class="p-8 text-center">
        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
        <h3 class="mt-2 text-sm font-medium text-gray-900 dark:text-white">暂无房屋</h3>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">开始添加您的第一套房屋吧！</p>
        <div class="mt-6">
          <button @click="showAddModal = true" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
            添加房屋
          </button>
        </div>
      </div>

      <div v-else>
        <!-- 桌面端表格 -->
        <div class="hidden md:block overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead class="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">房屋信息</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">租金</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">状态</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">租客信息</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">下次收租</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-for="house in houses" :key="house._id">
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="text-sm font-medium text-gray-900 dark:text-white">{{ house.code }} - {{ house.address }}</div>
                  <div class="text-sm text-gray-500 dark:text-gray-400">编号: {{ house.code }}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="text-sm font-medium text-gray-900 dark:text-white">¥{{ house.rent || 0 }}</div>
                  <div class="text-sm text-gray-500 dark:text-gray-400">每月</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <span :class="[
                    'px-2 py-1 text-xs font-medium rounded-full',
                    house.status === 'available' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                    'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                  ]">
                    {{ house.status === 'available' ? '可租' : '已租' }}
                  </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <div v-if="house.status === 'rented' && house.tenantInfo" class="text-sm">
                    <div class="font-medium text-gray-900 dark:text-white">{{ house.tenantInfo.name }}</div>
                    <div class="text-gray-500 dark:text-gray-400">入住: {{ formatDate(house.tenantInfo.moveInDate) }}</div>
                  </div>
                  <div v-else class="text-sm text-gray-500 dark:text-gray-400">-</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <div v-if="house.status === 'rented' && house.nextRentDue" class="text-sm">
                    <div class="font-medium text-gray-900 dark:text-white">¥{{ house.nextRentDue.amount }}</div>
                    <div :class="[
                      'text-xs',
                      house.nextRentDue.daysUntilDue <= 3 ? 'text-red-600 dark:text-red-400 font-medium' :
                      house.nextRentDue.daysUntilDue <= 7 ? 'text-yellow-600 dark:text-yellow-400' :
                      'text-gray-500 dark:text-gray-400'
                    ]">
                      {{ formatDate(house.nextRentDue.date) }}
                      <span v-if="house.nextRentDue.daysUntilDue >= 0">({{ house.nextRentDue.daysUntilDue }}天后)</span>
                      <span v-else class="text-red-600 dark:text-red-400">(已逾期{{ -house.nextRentDue.daysUntilDue }}天)</span>
                    </div>
                  </div>
                  <div v-else class="text-sm text-gray-500 dark:text-gray-400">-</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <button v-if="house.status === 'rented' && house.tenantInfo" @click="viewContract(house)" class="text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300 mr-4">合同</button>
                  <button @click="editHouse(house)" class="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 mr-4">编辑</button>
                  <button @click="deleteHouse(house._id)" class="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 移动端卡片列表 -->
        <div class="md:hidden space-y-4">
          <div v-for="house in houses" :key="house._id" class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
            <div class="flex justify-between items-start">
              <div>
                <h3 class="text-lg font-bold text-gray-900 dark:text-white">{{ house.code }} - {{ house.address }}</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">编号: {{ house.code }}</p>
              </div>
              <span :class="[
                'px-3 py-1 text-xs font-medium rounded-full',
                house.status === 'available' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
              ]">
                {{ house.status === 'available' ? '可租' : '已租' }}
              </span>
            </div>

            <div class="mt-4">
              <div class="flex justify-between items-center">
                <div>
                  <p class="text-sm text-gray-500 dark:text-gray-400">月租金</p>
                  <p class="text-lg font-bold text-gray-900 dark:text-white mt-1">¥{{ house.rent || 0 }}</p>
                </div>
              </div>
            </div>

            <!-- 租客信息（移动端） -->
            <div v-if="house.status === 'rented' && house.tenantInfo" class="mt-4">
              <div class="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                <p class="text-sm font-medium text-blue-700 dark:text-blue-300">租客信息</p>
                <p class="text-sm text-gray-900 dark:text-white mt-1">{{ house.tenantInfo.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">入住: {{ formatDate(house.tenantInfo.moveInDate) }}</p>
              </div>
            </div>

            <!-- 下次收租信息（移动端） -->
            <div v-if="house.status === 'rented' && house.nextRentDue" class="mt-4">
              <div :class="[
                'rounded-lg p-3',
                house.nextRentDue.daysUntilDue <= 3 ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' :
                house.nextRentDue.daysUntilDue <= 7 ? 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800' :
                'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
              ]">
                <p class="text-sm font-medium text-gray-900 dark:text-white">下次收租</p>
                <p class="text-lg font-bold text-gray-900 dark:text-white mt-1">¥{{ house.nextRentDue.amount }}</p>
                <p :class="[
                  'text-xs mt-1',
                  house.nextRentDue.daysUntilDue <= 3 ? 'text-red-600 dark:text-red-400 font-medium' :
                  house.nextRentDue.daysUntilDue <= 7 ? 'text-yellow-600 dark:text-yellow-400' :
                  'text-green-600 dark:text-green-400'
                ]">
                  {{ formatDate(house.nextRentDue.date) }}
                  <span v-if="house.nextRentDue.daysUntilDue >= 0">({{ house.nextRentDue.daysUntilDue }}天后)</span>
                  <span v-else class="text-red-600 dark:text-red-400">(已逾期{{ -house.nextRentDue.daysUntilDue }}天)</span>
                </p>
              </div>
            </div>

            <div class="mt-4 flex justify-end space-x-3">
              <button v-if="house.status === 'rented' && house.tenantInfo" @click="viewContract(house)" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm">合同</button>
              <button @click="editHouse(house)" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm">编辑</button>
              <button @click="deleteHouse(house._id)" class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 添加/编辑房屋模态框 -->
    <div v-if="showAddModal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div class="relative top-20 mx-auto p-5 border w-full max-w-md shadow-lg rounded-lg bg-white dark:bg-gray-800">
        <div class="flex justify-between items-center mb-6">
          <h3 class="text-lg font-medium text-gray-900 dark:text-white">{{ editingHouse ? '编辑房屋' : '添加房屋' }}</h3>
          <button @click="closeModal" class="text-gray-400 hover:text-gray-500">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form @submit.prevent="saveHouse">
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">房屋编号</label>
              <input v-model="houseForm.code" type="text" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="如：A101">
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">房屋地址</label>
              <select v-model="houseForm.address" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="">请选择地址</option>
                <option value="东楼北">东楼北</option>
                <option value="东楼南">东楼南</option>
                <option value="里召">里召</option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">月租金（元）</label>
              <input v-model="houseForm.rent" type="number" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">房屋状态</label>
              <select v-model="houseForm.status" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="available">可租</option>
                <option value="rented">已租</option>
              </select>
            </div>
          </div>

          <div class="mt-6 flex justify-end space-x-3">
            <button type="button" @click="closeModal" class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
              取消
            </button>
            <button type="submit" :disabled="saving" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
              {{ saving ? '保存中...' : '保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { dbService } from '../lib/database'

const router = useRouter()

interface House {
  _id: string
  code: string
  address: string
  rent: number
  status: string
  createdAt: Date
  updatedAt: Date
  tenantInfo?: {
    name: string
    id: string
    moveInDate: Date
  }
  nextRentDue?: {
    date: Date
    amount: number
    daysUntilDue: number
  }
}

const loading = ref(false)
const saving = ref(false)
const showAddModal = ref(false)
const editingHouse = ref<House | null>(null)

const houses = ref<House[]>([])
const filters = ref({
  status: '',
  minRent: '',
  maxRent: '',
  code: ''
})

const houseForm = ref({
  code: '',
  address: '',
  rent: 0,
  status: 'available'
})

const loadHouses = async () => {
  loading.value = true
  try {
    const result = await dbService.getHouses(filters.value)
    const housesData = result.data

    // 获取所有活跃租客
    const tenantsResult = await dbService.getTenants({ status: 'active' })
    const activeTenants = tenantsResult.data

    // 创建租客ID到租客信息的映射
    const tenantMap = new Map<string, any>()
    activeTenants.forEach(tenant => {
      tenantMap.set(tenant.houseId, tenant)
    })

    // 为每个房屋添加租客信息和下次收租日
    const enrichedHouses = await Promise.all(housesData.map(async (house: any) => {
      const enrichedHouse: House = { ...house }

      // 如果房屋已租且有租客，添加租客信息
      if (house.status === 'rented') {
        const tenant = tenantMap.get(house._id)
        if (tenant) {
          enrichedHouse.tenantInfo = {
            name: tenant.name,
            id: tenant._id,
            moveInDate: new Date(tenant.moveInDate)
          }

          // 计算下次收租日
          try {
            const rentInfo = await dbService.getNextRentDueDate(tenant._id)
            const today = new Date()
            const daysUntilDue = Math.ceil((rentInfo.nextDueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

            enrichedHouse.nextRentDue = {
              date: rentInfo.nextDueDate,
              amount: rentInfo.amount,
              daysUntilDue: daysUntilDue
            }
          } catch (error) {
            console.error(`计算房屋 ${house.code} 的下次收租日失败:`, error)
          }
        }
      }

      return enrichedHouse
    }))

    houses.value = enrichedHouses
  } catch (error) {
    console.error('加载房屋失败:', error)
  } finally {
    loading.value = false
  }
}

const saveHouse = async () => {
  saving.value = true
  try {
    if (editingHouse.value) {
      await dbService.updateHouse(editingHouse.value._id, houseForm.value)
    } else {
      await dbService.addHouse(houseForm.value)
    }
    closeModal()
    loadHouses()
  } catch (error) {
    console.error('保存房屋失败:', error)
  } finally {
    saving.value = false
  }
}

const editHouse = (house: House) => {
  editingHouse.value = house
  houseForm.value = {
    code: house.code || '',
    address: house.address || '',
    rent: house.rent || 0,
    status: house.status || 'available'
  }
  showAddModal.value = true
}

const deleteHouse = async (id: string) => {
  if (confirm('确定要删除这个房屋吗？')) {
    try {
      await dbService.deleteHouse(id)
      loadHouses()
    } catch (error) {
      console.error('删除房屋失败:', error)
    }
  }
}

const resetFilters = () => {
  filters.value = {
    status: '',
    minRent: '',
    maxRent: '',
    code: ''
  }
  loadHouses()
}

const closeModal = () => {
  showAddModal.value = false
  editingHouse.value = null
  houseForm.value = {
    code: '',
    address: '',
    rent: 0,
    status: 'available'
  }
}

const formatDate = (date: Date | string) => {
  if (!date) return '未设置'
  return new Date(date).toLocaleDateString('zh-CN')
}

const viewContract = (house: House) => {
  if (house.tenantInfo?.id) {
    router.push({ path: '/contract', query: { tenantId: house.tenantInfo.id } })
  }
}

onMounted(() => {
  loadHouses()
})
</script>