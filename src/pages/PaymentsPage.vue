<template>
  <div class="container mx-auto px-4 py-8">
    <div class="mb-8">
      <div class="flex justify-between items-center">
        <div>
          <h1 class="text-xl font-bold text-gray-900 dark:text-white">缴费记录</h1>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">共 {{ payments.length }} 条记录</p>
        </div>
        <button @click="showAddModal = true" class="flex items-center gap-1.5 px-5 py-3 bg-blue-600 text-white rounded-xl font-medium shadow-lg shadow-blue-200/50 dark:shadow-blue-900/30 active:scale-95 transition-all">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
          </svg>
          添加缴费
        </button>
      </div>
    </div>

    <!-- App风格筛选器 -->
    <div class="flex items-center gap-2 overflow-x-auto mb-4 pb-1 scrollbar-hide">
      <select v-model="filters.houseId" @change="loadPayments" class="shrink-0 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-full bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
        <option value="">全部房屋</option>
        <option v-for="house in availableHouses" :key="house._id" :value="house._id">{{ house.code }}-{{ house.address }}</option>
      </select>
      <button @click="filters.paymentType = ''; loadPayments()" class="shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-colors" :class="!filters.paymentType ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'">
        全部
      </button>
      <button @click="filters.paymentType = 'rent'; loadPayments()" class="shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-colors" :class="filters.paymentType === 'rent' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'">
        租金
      </button>
      <button @click="filters.paymentType = 'utility'; loadPayments()" class="shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-colors" :class="filters.paymentType === 'utility' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'">
        水电
      </button>
      <button @click="filters.paymentType = 'deposit'; loadPayments()" class="shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-colors" :class="filters.paymentType === 'deposit' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'">
        押金
      </button>
      <button @click="filters.status = filters.status === 'paid' ? '' : 'paid'; loadPayments()" class="shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-colors" :class="filters.status === 'paid' ? 'bg-green-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'">
        已缴
      </button>
      <div class="flex items-center gap-1 shrink-0">
        <input v-model="filters.startDate" type="date" class="w-24 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white" @change="loadPayments">
        <span class="text-gray-400">~</span>
        <input v-model="filters.endDate" type="date" class="w-24 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white" @change="loadPayments">
      </div>
      <button @click="resetFilters" class="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
        清空
      </button>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-gray-500 dark:text-gray-400 text-sm">本月总收入</p>
            <p class="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">¥{{ stats.monthlyTotal }}</p>
          </div>
          <div class="p-3 bg-green-100 dark:bg-green-900/30 rounded-full">
            <svg class="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-gray-500 dark:text-gray-400 text-sm">近3天到期</p>
            <p class="text-2xl font-bold text-yellow-600 dark:text-yellow-400 mt-1">¥{{ stats.upcomingTotal }}</p>
          </div>
          <div class="p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-full">
            <svg class="w-6 h-6 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-gray-500 dark:text-gray-400 text-sm">逾期费用</p>
            <p class="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">¥{{ stats.overdueTotal }}</p>
          </div>
          <div class="p-3 bg-red-100 dark:bg-red-900/30 rounded-full">
            <svg class="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.998-.833-2.732 0L4.284 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <!-- 加载 / 空状态 -->
    <div v-if="loading" class="py-12 text-center">
      <span class="loading loading-dots loading-md text-blue-600"></span>
    </div>

    <div v-else-if="payments.length === 0" class="py-12 text-center">
      <svg class="mx-auto h-10 w-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p class="mt-2 text-sm text-gray-500">暂无缴费记录</p>
    </div>

    <!-- 桌面端表格 (md+) -->
    <template v-else>
      <div class="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead class="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th class="w-[30%] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">缴费信息</th>
              <th class="w-[22%] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">房屋/租客</th>
              <th class="w-[13%] px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400">金额</th>
              <th class="w-[17%] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">日期</th>
              <th class="w-[10%] px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400">状态</th>
              <th class="w-[8%] px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
            <tr v-for="payment in payments" :key="payment._id" class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td class="px-4 py-3">
                <div class="text-sm font-medium text-gray-900 dark:text-white">{{ getPaymentTypeText(payment.paymentType) }}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[180px]">{{ (payment.description || '—') }}</div>
              </td>
              <td class="px-4 py-3">
                <div class="text-sm text-gray-900 dark:text-white truncate max-w-[140px]">{{ getHouseAddress(payment.houseId) }}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400">{{ getTenantName(payment.tenantId) }}</div>
              </td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <div class="text-base font-bold text-gray-900 dark:text-white">¥{{ formatAmount(payment.amount) }}</div>
              </td>
              <td class="px-4 py-3 whitespace-nowrap">
                <div class="text-sm text-gray-900 dark:text-white">{{ formatDate(payment.paymentDate) }}</div>
              </td>
              <td class="px-4 py-3 text-center whitespace-nowrap">
                <span class="inline-block px-2 py-0.5 text-xs rounded-full font-medium"
                  :class="payment.status === 'paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                  payment.status === 'pending' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'">
                  {{ payment.status === 'paid' ? '已缴' : payment.status === 'pending' ? '待缴' : '逾期' }}
                </span>
              </td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <button v-if="payment.status !== 'paid'" @click="markAsPaid(payment._id)" class="text-green-600 hover:text-green-800 dark:text-green-400 text-xs font-medium mr-2">已缴</button>
                <button @click="deletePayment(payment._id)" class="text-red-500 hover:text-red-700 dark:text-red-400 text-xs font-medium">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 移动端卡片列表 (小于 md) -->
      <div class="md:hidden space-y-2">
        <div v-for="payment in payments" :key="payment._id" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-3.5 py-3">
          <!-- 卡片行：类型 + 金额 + 状态 -->
          <div class="flex items-center justify-between mb-1">
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold text-gray-900 dark:text-white">{{ getPaymentTypeText(payment.paymentType) }}</span>
              <span v-if="payment.description?.includes('退租结算')" class="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">退租</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold text-gray-900 dark:text-white">¥{{ formatAmount(payment.amount) }}</span>
              <span class="text-xs px-1.5 py-0.5 rounded-full font-medium"
                :class="payment.status === 'paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                payment.status === 'pending' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'">
                {{ payment.status === 'paid' ? '已缴' : payment.status === 'pending' ? '待缴' : '逾期' }}
              </span>
            </div>
          </div>
          <!-- 卡片行：房屋编号 + 日期 + 详情按钮 -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span class="font-medium text-gray-700 dark:text-gray-300">{{ getHouseAddress(payment.houseId) }}</span>
              <span class="text-gray-300 dark:text-gray-600">|</span>
              <span>{{ formatDate(payment.paymentDate) }}</span>
            </div>
            <button @click="showDetail(payment)" class="text-xs text-blue-600 dark:text-blue-400 font-medium">详情 ›</button>
          </div>
        </div>
      </div>
    </template>

    <!-- 缴费详情弹窗 -->
    <div v-if="showDetailModal && detailPayment" class="fixed inset-0 bg-gray-600/50 z-50" @click.self="showDetailModal = false">
      <div class="absolute bottom-0 md:relative md:top-20 mx-auto p-5 border w-full md:max-w-sm rounded-t-2xl md:rounded-2xl shadow-xl bg-white dark:bg-gray-800">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-bold text-gray-900 dark:text-white">{{ getPaymentTypeText(detailPayment.paymentType) }}</h3>
          <button @click="showDetailModal = false" class="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
            <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="space-y-3 text-sm">
          <div class="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400">金额</span>
            <span class="font-bold text-gray-900 dark:text-white">¥{{ formatAmount(detailPayment.amount) }}</span>
          </div>
          <div class="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400">房屋</span>
            <span class="text-gray-900 dark:text-white">{{ getHouseAddress(detailPayment.houseId) }}</span>
          </div>
          <div class="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400">租客</span>
            <span class="text-gray-900 dark:text-white">{{ getTenantName(detailPayment.tenantId) }}</span>
          </div>
          <div class="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400">日期</span>
            <span class="text-gray-900 dark:text-white">{{ formatDate(detailPayment.paymentDate) }}</span>
          </div>
          <div class="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400">周期</span>
            <span class="text-gray-900 dark:text-white">{{ detailPayment.period || '一次性' }}</span>
          </div>
          <div class="py-2">
            <span class="text-gray-500 dark:text-gray-400 block mb-1">描述</span>
            <span class="text-gray-900 dark:text-white">{{ detailPayment.description || '无' }}</span>
          </div>
        </div>
        <div class="mt-4 flex gap-3">
          <button v-if="detailPayment.status !== 'paid'" @click="markAsPaid(detailPayment._id); showDetailModal = false" class="flex-1 py-2.5 rounded-xl bg-green-500 text-white text-sm font-medium">标记已缴</button>
          <button @click="deletePayment(detailPayment._id); showDetailModal = false" class="flex-1 py-2.5 rounded-xl border border-red-200 text-red-500 text-sm font-medium">删除</button>
        </div>
      </div>
    </div>

    <!-- 添加缴费记录模态框 -->
    <div v-if="showAddModal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div class="relative top-20 mx-auto p-5 border w-full max-w-md shadow-lg rounded-lg bg-white dark:bg-gray-800">
        <div class="flex justify-between items-center mb-6">
          <h3 class="text-lg font-medium text-gray-900 dark:text-white">添加缴费记录</h3>
          <button @click="closeModal" class="text-gray-400 hover:text-gray-500">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form @submit.prevent="savePayment">
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">缴费类型</label>
              <select v-model="paymentForm.paymentType" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="rent">租金</option>
                <option value="utility">水电费</option>
                <option value="deposit">押金</option>
                <option value="other">其他</option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">所属房屋</label>
              <select v-model="paymentForm.houseId" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="">请选择房屋</option>
                <option v-for="house in availableHouses" :key="house._id" :value="house._id">
                  {{ house.code }} - {{ house.address }}
                </option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">所属租客</label>
              <div v-if="paymentForm.tenantId" class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white">
                {{ getTenantName(paymentForm.tenantId) }}
              </div>
              <div v-else class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-400">
                请先选择房屋
              </div>
            </div>

            <!-- 水电费：显示电表/水表读数输入 -->
            <template v-if="paymentForm.paymentType === 'utility'">
              <div class="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <p class="text-sm font-medium text-blue-700 dark:text-blue-300 mb-2">水电费计算</p>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">上次电表读数</label>
                    <div class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white text-sm">
                      {{ lastUtilityReading?.electricity ?? '—' }}
                    </div>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">上次水表读数</label>
                    <div class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white text-sm">
                      {{ lastUtilityReading?.water ?? '—' }}
                    </div>
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">本次电表读数 <span class="text-red-500">*</span></label>
                    <input v-model="paymentForm.electricityReading" type="number" step="0.01" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" placeholder="当前电表度数">
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">本次水表读数 <span class="text-red-500">*</span></label>
                    <input v-model="paymentForm.waterReading" type="number" step="0.01" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" placeholder="当前水表度数">
                  </div>
                </div>
                <div class="mt-2 pt-2 border-t border-blue-200 dark:border-blue-700">
                  <div class="flex justify-between text-sm text-blue-700 dark:text-blue-300">
                    <span>用电: {{ computedElectricityUsage }} 度 × ¥{{ elecPrice }}/度</span>
                    <span>¥{{ computedElectricityCost.toFixed(1) }}</span>
                  </div>
                  <div class="flex justify-between text-sm text-blue-700 dark:text-blue-300">
                    <span>用水: {{ computedWaterUsage }} 吨 × ¥{{ waterPrice }}/吨</span>
                    <span>¥{{ computedWaterCost.toFixed(1) }}</span>
                  </div>
                  <div class="flex justify-between font-bold text-blue-800 dark:text-blue-200 mt-1 pt-1 border-t border-blue-200 dark:border-blue-700">
                    <span>合计</span>
                    <span>¥{{ computedTotalCost.toFixed(1) }}</span>
                  </div>
                </div>
              </div>
            </template>
            <!-- 非水电费：显示金额输入 -->
            <template v-else>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">金额（元）</label>
                <input v-model="paymentForm.amount" type="number" step="0.01" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              </div>
            </template>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">缴费日期</label>
              <input v-model="paymentForm.paymentDate" type="date" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">缴费周期</label>
              <input v-model="paymentForm.period" type="text" placeholder="如：2024-05" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">描述</label>
              <textarea v-model="paymentForm.description" rows="3" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"></textarea>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">缴费状态</label>
              <select v-model="paymentForm.status" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="paid">已缴</option>
                <option value="pending">待缴</option>
                <option value="overdue">逾期</option>
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
import { ref, computed, onMounted, watch } from 'vue'
import { dbService } from '../lib/database'

interface Payment {
  _id: string
  houseId: string
  tenantId: string
  paymentType: string
  amount: number
  paymentDate: Date
  period: string
  description: string
  status: string
  createdAt: Date
}

interface House {
  _id: string
  code: string
  address: string
}

interface Tenant {
  _id: string
  name: string
  houseId: string
  status?: string
}

const loading = ref(false)
const saving = ref(false)
const showAddModal = ref(false)
const showDetailModal = ref(false)
const detailPayment = ref<any>(null)

const payments = ref<Payment[]>([])
const availableHouses = ref<House[]>([])
const availableTenants = ref<Tenant[]>([])
const filters = ref({
  houseId: '',
  paymentType: '',
  status: '',
  startDate: '',
  endDate: ''
})

const stats = ref({
  monthlyTotal: 0,
  upcomingTotal: 0,
  overdueTotal: 0
})

const paymentForm = ref({
  houseId: '',
  tenantId: '',
  paymentType: 'rent',
  amount: 0,
  paymentDate: new Date().toISOString().split('T')[0],
  period: '',
  description: '',
  status: 'paid',
  electricityReading: 0,
  waterReading: 0
})

// 水电费计算相关
const elecPrice = 0.8
const waterPrice = 3.5
const lastUtilityReading = ref<{ electricity: number; water: number } | null>(null)

const computedElectricityUsage = computed(() => {
  if (paymentForm.value.paymentType !== 'utility') return 0
  const last = lastUtilityReading.value?.electricity || 0
  return Math.max(0, Number(paymentForm.value.electricityReading) - last)
})

const computedWaterUsage = computed(() => {
  if (paymentForm.value.paymentType !== 'utility') return 0
  const last = lastUtilityReading.value?.water || 0
  return Math.max(0, Number(paymentForm.value.waterReading) - last)
})

const computedElectricityCost = computed(() => computedElectricityUsage.value * elecPrice)
const computedWaterCost = computed(() => computedWaterUsage.value * waterPrice)
const computedTotalCost = computed(() => computedElectricityCost.value + computedWaterCost.value)

// 当房屋/租客变化且类型为水电费时，加载上次水电读数
const loadLastUtilityReading = async (tenantId: string) => {
  if (!tenantId || paymentForm.value.paymentType !== 'utility') return
  try {
    const result = await dbService.getUtilityRecords({ tenantId })
    if (result.data && result.data.length > 0) {
      const last = result.data[0] as any
      lastUtilityReading.value = {
        electricity: last.electricityReading || 0,
        water: last.waterReading || 0
      }
    } else {
      lastUtilityReading.value = null
    }
  } catch (error) {
    console.warn('获取上次水电读数失败:', error)
    lastUtilityReading.value = null
  }
}

const loadPayments = async () => {
  loading.value = true
  try {
    const result = await dbService.getPayments(filters.value)
    payments.value = result.data
    await calculateStats()
  } catch (error) {
    console.error('加载缴费记录失败:', error)
  } finally {
    loading.value = false
  }
}

const calculateStats = async () => {
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()

  stats.value.monthlyTotal = payments.value
    .filter((p: any) => {
      const date = new Date(p.paymentDate)
      return date.getMonth() === currentMonth &&
             date.getFullYear() === currentYear &&
             p.status === 'paid'
    })
    .reduce((sum: number, p: any) => sum + (p.amount || 0), 0)

  // 先统计数据库中标记为 pending/overdue 的记录
  const dbPending = payments.value
    .filter((p: any) => p.status === 'pending')
    .reduce((sum: number, p: any) => sum + (p.amount || 0), 0)

  let overdueTotal = payments.value
    .filter((p: any) => p.status === 'overdue')
    .reduce((sum: number, p: any) => sum + (p.amount || 0), 0)

  let upcomingTotal = dbPending

  // 加上动态计算的数据（来自仪表盘收费提醒）
  try {
    const houses = await dbService.getUpcomingRentHouses(3)
    for (const house of houses) {
      // 逾期部分计入逾期费用
      if (house.totalOverdue > 0) {
        overdueTotal += house.totalOverdue
      }
      // 未来3天内到期（未逾期）的部分计入近3天到期
      if (house.upcomingItem && house.upcomingItem.daysUntilDue >= 0) {
        upcomingTotal += house.upcomingItem.amount
      }
    }
  } catch (error) {
    console.warn('获取动态逾期数据失败:', error)
  }

  stats.value.upcomingTotal = upcomingTotal
  stats.value.overdueTotal = overdueTotal
}

const loadHouses = async () => {
  try {
    // 加载全部房屋（含已退租的，以便显示历史缴费记录对应的房屋名称）
    const result = await dbService.getHouses()
    availableHouses.value = result.data
  } catch (error) {
    console.error('加载房屋失败:', error)
  }
}

const loadTenants = async () => {
  try {
    // 加载全部租客（含已退租的，以便显示历史缴费记录对应的租客名称）
    const result = await dbService.getTenants()
    availableTenants.value = result.data
  } catch (error) {
    console.error('加载租客失败:', error)
  }
}

// 当选择房屋时，自动关联该房屋对应的租客
watch(() => paymentForm.value.houseId, async (newHouseId) => {
  if (newHouseId) {
    const activeTenant = availableTenants.value.find(t => t.houseId === newHouseId)
    if (activeTenant) {
      paymentForm.value.tenantId = activeTenant._id
      await loadLastUtilityReading(activeTenant._id)
    } else {
      paymentForm.value.tenantId = ''
    }
  } else {
    paymentForm.value.tenantId = ''
    lastUtilityReading.value = null
  }
})

// 当缴费类型切换为水电费时，尝试加载上次读数
watch(() => paymentForm.value.paymentType, async (type) => {
  if (type === 'utility' && paymentForm.value.tenantId) {
    await loadLastUtilityReading(paymentForm.value.tenantId)
  } else {
    lastUtilityReading.value = null
  }
})

const savePayment = async () => {
  saving.value = true
  try {
    const formData = { ...paymentForm.value }

    if (formData.paymentType === 'utility') {
      // 水电费：使用自动计算的总金额，且自动填充描述
      formData.amount = computedTotalCost.value
      const lastElec = lastUtilityReading.value?.electricity || 0
      const lastWater = lastUtilityReading.value?.water || 0
      formData.description = `电表: ${lastElec}→${formData.electricityReading} (${computedElectricityUsage.value}度) + 水表: ${lastWater}→${formData.waterReading} (${computedWaterUsage.value}吨)`

      // 先创建设备读数记录
      if (Number(formData.electricityReading) > 0 || Number(formData.waterReading) > 0) {
        await dbService.addUtilityRecord({
          houseId: formData.houseId,
          tenantId: formData.tenantId,
          electricityReading: Number(formData.electricityReading),
          waterReading: Number(formData.waterReading),
          electricityUsage: computedElectricityUsage.value,
          waterUsage: computedWaterUsage.value,
          electricityCost: computedElectricityCost.value,
          waterCost: computedWaterCost.value,
          totalCost: computedTotalCost.value,
        })
      }
    }

    await dbService.addPayment(formData)
    closeModal()
    loadPayments()
  } catch (error) {
    console.error('保存缴费记录失败:', error)
  } finally {
    saving.value = false
  }
}

const showDetail = (payment: any) => {
  detailPayment.value = payment
  showDetailModal.value = true
}

const markAsPaid = async (id: string) => {
  try {
    await dbService.updatePayment(id, { status: 'paid' })
    loadPayments()
  } catch (error) {
    console.error('标记已缴失败:', error)
  }
}

const deletePayment = async (id: string) => {
  if (confirm('确定要删除这个缴费记录吗？')) {
    try {
      await dbService.deletePayment(id)
      loadPayments()
    } catch (error) {
      console.error('删除缴费记录失败:', error)
    }
  }
}

const resetFilters = () => {
  filters.value = {
    houseId: '',
    paymentType: '',
    status: '',
    startDate: '',
    endDate: ''
  }
  loadPayments()
}

const closeModal = () => {
  showAddModal.value = false
  lastUtilityReading.value = null
  paymentForm.value = {
    houseId: '',
    tenantId: '',
    paymentType: 'rent',
    amount: 0,
    paymentDate: new Date().toISOString().split('T')[0],
    period: '',
    description: '',
    status: 'paid',
    electricityReading: 0,
    waterReading: 0
  }
}

const getPaymentTypeText = (type: string) => {
  const types: Record<string, string> = {
    'rent': '租金',
    'utility': '水电费',
    'deposit': '押金',
    'other': '其他'
  }
  return types[type] || type
}

const getHouseCode = (houseId: string) => {
  const house = availableHouses.value.find(h => h._id === houseId)
  return house?.code || '—'
}

const getHouseAddress = (houseId: string) => {
  const house = availableHouses.value.find(h => h._id === houseId)
  return house ? `${house.code} - ${house.address}` : '未知房屋'
}

const getTenantName = (tenantId: string) => {
  const tenant = availableTenants.value.find(t => t._id === tenantId)
  return tenant ? tenant.name : '未知租客'
}

const formatAmount = (val: number) => {
  const n = Number(val)
  return Number.isInteger(n) ? n.toFixed(1) : n.toFixed(1)
}

const formatDate = (date: Date | string) => {
  if (!date) return '未设置'
  return new Date(date).toLocaleDateString('zh-CN')
}

onMounted(() => {
  loadPayments()
  loadHouses()
  loadTenants()
})
</script>