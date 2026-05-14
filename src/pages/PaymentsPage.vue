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
    <div class="grid grid-cols-3 gap-3 mb-6">
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-3.5">
        <div class="flex items-center justify-between mb-1">
          <p class="text-xs text-gray-500 dark:text-gray-400">租金收入</p>
          <div class="w-7 h-7 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <svg class="w-3.5 h-3.5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
        <p class="text-lg font-bold text-gray-900 dark:text-white">¥{{ stats.rentTotal }}</p>
      </div>
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-3.5">
        <div class="flex items-center justify-between mb-1">
          <p class="text-xs text-gray-500 dark:text-gray-400">在管押金</p>
          <div class="w-7 h-7 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
            <svg class="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
        </div>
        <p class="text-lg font-bold text-gray-900 dark:text-white">¥{{ stats.depositTotal }}</p>
      </div>
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-3.5">
        <div class="flex items-center justify-between mb-1">
          <p class="text-xs text-gray-500 dark:text-gray-400">水电费</p>
          <div class="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <svg class="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
        </div>
        <p class="text-lg font-bold text-gray-900 dark:text-white">¥{{ stats.utilityTotal }}</p>
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
                  :class="payment.amount < 0 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' :
                  payment.status === 'paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                  payment.status === 'pending' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'">
                  {{ payment.amount < 0 ? '退款' : payment.status === 'paid' ? '已缴' : payment.status === 'pending' ? '待缴' : '逾期' }}
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
                :class="payment.amount < 0 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' :
                payment.status === 'paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                payment.status === 'pending' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'">
                {{ payment.amount < 0 ? '退款' : payment.status === 'paid' ? '已缴' : payment.status === 'pending' ? '待缴' : '逾期' }}
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
                <option value="">请选择房屋（仅显示已出租）</option>
                <option v-for="house in rentedHouses" :key="house._id" :value="house._id">
                  {{ house.code }} - {{ house.address }}
                </option>
              </select>
              <p v-if="rentedHouses.length === 0" class="text-xs text-yellow-600 dark:text-yellow-400 mt-1">暂无已出租的房屋</p>
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
                      {{ baselineElecReading }}
                    </div>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">上次水表读数</label>
                    <div class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white text-sm">
                      {{ baselineWaterReading }}
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
              <!-- 租金覆盖预览（预付制） -->
              <div v-if="paymentForm.paymentType === 'rent' && coveragePreview" class="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <p class="text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">📅 租金覆盖预览（预付制）</p>
                <div class="text-sm space-y-1 text-blue-600 dark:text-blue-400">
                  <div v-if="coveragePreview.currentCoveredUntil" class="flex justify-between">
                    <span>当前已覆盖到</span>
                    <span class="font-medium">{{ formatCoverageDate(coveragePreview.currentCoveredUntil) }}</span>
                  </div>
                  <div v-else class="flex justify-between">
                    <span>当前覆盖起始</span>
                    <span class="font-medium">{{ formatCoverageDate(selectedTenantInfo?.moveInDate) }}（入住日）</span>
                  </div>
                  <div class="flex justify-between font-medium">
                    <span>本次覆盖 {{ coveragePreview.monthsCovered >= 1 ? Math.floor(coveragePreview.monthsCovered) + '个月' : '' }}{{ coveragePreview.hasHalfMonth ? ' + 半个月' : '' }}</span>
                    <span>¥{{ Number(paymentForm.amount).toFixed(1) }}</span>
                  </div>
                  <div class="flex justify-between pt-1 border-t border-blue-200 dark:border-blue-700">
                    <span class="font-bold text-blue-800 dark:text-blue-200">将覆盖到</span>
                    <span class="font-bold text-blue-800 dark:text-blue-200">{{ formatCoverageDate(coveragePreview.newCoveredUntil) }}</span>
                  </div>
                  <div v-if="coveragePreview.depositIncrease > 0" class="flex justify-between text-orange-600 dark:text-orange-400">
                    <span>溢出 ¥{{ coveragePreview.depositIncrease.toFixed(1) }} → 转入押金</span>
                    <span>+¥{{ coveragePreview.depositIncrease.toFixed(1) }}</span>
                  </div>
                </div>
              </div>
            </template>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">缴费日期</label>
              <input v-model="paymentForm.paymentDate" type="date" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">缴费周期</label>
              <div v-if="selectedTenantInfo" class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300 text-sm">
                {{ getPaymentCycleLabel((selectedTenantInfo as any).paymentCycle) }}（{{ paymentForm.period }}）
              </div>
              <div v-else class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-sm">
                请先选择房屋/租客
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">描述</label>
              <textarea v-model="paymentForm.description" rows="3" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"></textarea>
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
  status?: string
  rent?: number
}

interface Tenant {
  _id: string
  name: string
  houseId: string
  status?: string
  rent?: number
  rentCoveredUntil?: Date
  moveInDate?: Date
  deposit?: number
}

const loading = ref(false)
const saving = ref(false)
const showAddModal = ref(false)
const showDetailModal = ref(false)
const detailPayment = ref<any>(null)

const payments = ref<Payment[]>([])
const availableHouses = ref<House[]>([])
const availableTenants = ref<Tenant[]>([])
const rentedHouses = computed(() => availableHouses.value.filter(h => h.status === 'rented'))
const filters = ref({
  houseId: '',
  paymentType: '',
  status: '',
  startDate: new Date().getFullYear() + '-01-01',
  endDate: ''
})

const stats = ref({
  rentTotal: 0,
  depositTotal: 0,
  utilityTotal: 0
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

// 水电费基准读数：上次缴费记录 → 入住读数 → 0
const baselineElecReading = computed(() => {
  if (lastUtilityReading.value) return lastUtilityReading.value.electricity
  const tenant = selectedTenantInfo.value
  return (tenant as any)?.moveInElectricity || 0
})

const baselineWaterReading = computed(() => {
  if (lastUtilityReading.value) return lastUtilityReading.value.water
  const tenant = selectedTenantInfo.value
  return (tenant as any)?.moveInWater || 0
})

const computedElectricityUsage = computed(() => {
  if (paymentForm.value.paymentType !== 'utility') return 0
  return Math.max(0, Number(paymentForm.value.electricityReading) - baselineElecReading.value)
})

const computedWaterUsage = computed(() => {
  if (paymentForm.value.paymentType !== 'utility') return 0
  return Math.max(0, Number(paymentForm.value.waterReading) - baselineWaterReading.value)
})

const computedElectricityCost = computed(() => computedElectricityUsage.value * elecPrice)
const computedWaterCost = computed(() => computedWaterUsage.value * waterPrice)
const computedTotalCost = computed(() => computedElectricityCost.value + computedWaterCost.value)

// 租金覆盖预览（预付制）
const selectedTenantInfo = computed(() => {
  if (!paymentForm.value.tenantId) return null
  return availableTenants.value.find(t => t._id === paymentForm.value.tenantId) || null
})

const coveragePreview = computed(() => {
  if (paymentForm.value.paymentType !== 'rent') return null
  const tenant = selectedTenantInfo.value
  if (!tenant || !paymentForm.value.amount || !tenant.rent) return null

  const monthlyRent = tenant.rent
  const amount = Number(paymentForm.value.amount)
  const moveInDate = tenant.moveInDate ? new Date(tenant.moveInDate) : new Date()
  const halfThreshold = monthlyRent / 2
  const fullMonths = Math.floor(amount / monthlyRent)
  const remaining = amount - fullMonths * monthlyRent

  const currentCoveredUntil = (tenant as any).rentCoveredUntil ? new Date((tenant as any).rentCoveredUntil) : null

  let coverageStart: Date
  if (currentCoveredUntil) {
    coverageStart = new Date(currentCoveredUntil)
    coverageStart.setDate(coverageStart.getDate() + 1)
  } else {
    coverageStart = new Date(moveInDate)
  }

  const endDate = new Date(coverageStart)
  endDate.setMonth(endDate.getMonth() + fullMonths)

  let depositIncrease = 0
  let hasHalfMonth = false
  if (remaining >= halfThreshold) {
    endDate.setDate(endDate.getDate() + 15)
    hasHalfMonth = true
    depositIncrease = remaining - halfThreshold
  } else if (remaining > 0) {
    depositIncrease = remaining
  }

  const newCoveredUntil = new Date(endDate)
  newCoveredUntil.setDate(newCoveredUntil.getDate() - 1)

  return {
    currentCoveredUntil,
    newCoveredUntil,
    monthsCovered: fullMonths + (hasHalfMonth ? 0.5 : 0),
    depositIncrease,
    hasHalfMonth
  }
})

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
      // 默认填入上次读数，方便房东以之为基准填入当前表数
      paymentForm.value.electricityReading = last.electricityReading || 0
      paymentForm.value.waterReading = last.waterReading || 0
    } else {
      lastUtilityReading.value = null
      // 无上次读数则从入住读数开始（通过租客信息中的 moveInElectricity/Water）
      const tenant = selectedTenantInfo.value
      if (tenant) {
        const tenantAny = tenant as any
        const moveInElec = tenantAny.moveInElectricity || 0
        const moveInWater = tenantAny.moveInWater || 0
        if (moveInElec > 0) paymentForm.value.electricityReading = moveInElec
        if (moveInWater > 0) paymentForm.value.waterReading = moveInWater
      }
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
  // 根据筛选时间段统计已缴费用，按类型分组
  const paid = payments.value.filter((p: any) => p.status === 'paid')

  // 如果设置了日期筛选，按筛选范围统计
  let filtered = paid
  if (filters.value.startDate || filters.value.endDate) {
    filtered = paid.filter((p: any) => {
      const d = new Date(p.paymentDate)
      if (filters.value.startDate && d < new Date(filters.value.startDate)) return false
      if (filters.value.endDate) {
        const end = new Date(filters.value.endDate)
        end.setDate(end.getDate() + 1)
        if (d >= end) return false
      }
      return true
    })
  }

  stats.value.rentTotal = filtered
    .filter((p: any) => p.paymentType === 'rent')
    .reduce((sum: number, p: any) => sum + (p.amount || 0), 0)

  // 在管押金 = 所有活跃租客的押金总和（已退租的自然归零）
  try {
    const activeTenants = await dbService.getTenants({ status: 'active' })
    stats.value.depositTotal = activeTenants.data.reduce((sum: number, t: any) => sum + (t.deposit || 0), 0)
  } catch {
    stats.value.depositTotal = 0
  }

  stats.value.utilityTotal = filtered
    .filter((p: any) => p.paymentType === 'utility')
    .reduce((sum: number, p: any) => sum + (p.amount || 0), 0)
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

// 当选择房屋时，自动关联该房屋对应的当前在住租客
watch(() => paymentForm.value.houseId, async (newHouseId) => {
  if (newHouseId) {
    const activeTenant = availableTenants.value.find(t => t.houseId === newHouseId && t.status === 'active')
    if (activeTenant) {
      paymentForm.value.tenantId = activeTenant._id
      // 自动填充缴费周期为该租客合同的支付方式
      const cycle = (activeTenant as any).paymentCycle || 'month'
      paymentForm.value.period = getPaymentCycleLabel(cycle)
      await loadLastUtilityReading(activeTenant._id)
    } else {
      paymentForm.value.tenantId = ''
      paymentForm.value.period = ''
    }
  } else {
    paymentForm.value.tenantId = ''
    paymentForm.value.period = ''
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

const getPaymentCycleLabel = (cycle: string) => {
  const labels: Record<string, string> = {
    month: '月付',
    quarter: '季付',
    half_year: '半年付',
    year: '年付'
  }
  return labels[cycle] || cycle || '—'
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

const formatCoverageDate = (date: Date | string | undefined | null) => {
  if (!date) return '—'
  const d = new Date(date)
  return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}（${d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}）`
}

onMounted(() => {
  loadPayments()
  loadHouses()
  loadTenants()
})
</script>