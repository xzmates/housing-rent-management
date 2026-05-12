<template>
  <div class="container mx-auto px-4 py-8">
    <div class="mb-8">
      <div class="flex justify-between items-center">
        <div>
          <h1 class="text-xl font-bold text-gray-900 dark:text-white">租客管理</h1>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">共 {{ tenants.length }} 位租客</p>
        </div>
        <button @click="showAddModal = true" class="flex items-center gap-1.5 px-5 py-3 bg-purple-600 text-white rounded-xl font-medium shadow-lg shadow-purple-200/50 dark:shadow-purple-900/30 active:scale-95 transition-all">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
          </svg>
          添加租客
        </button>
      </div>
    </div>

    <!-- App风格筛选器 -->
    <div class="flex items-center gap-2 overflow-x-auto mb-4 pb-1 scrollbar-hide">
      <button @click="filters.status = ''; filters.houseId = ''; filters.name = ''; loadTenants()" class="shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-colors" :class="!filters.status ? 'bg-purple-600 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'">
        全部
      </button>
      <button @click="filters.status = 'active'; loadTenants()" class="shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-colors" :class="filters.status === 'active' ? 'bg-green-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'">
        在住的
      </button>
      <button @click="filters.status = 'moved_out'; loadTenants()" class="shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-colors" :class="filters.status === 'moved_out' ? 'bg-gray-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'">
        已退租
      </button>
      <select v-model="filters.houseId" @change="loadTenants" class="shrink-0 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-full bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
        <option value="">全部房屋</option>
        <option v-for="house in availableHouses" :key="house._id" :value="house._id">{{ house.code }}-{{ house.address }}</option>
      </select>
      <input v-model="filters.name" type="text" placeholder="搜姓名" class="w-20 shrink-0 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-full bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400" @input="loadTenants">
      <button @click="resetFilters" class="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
        清空
      </button>
    </div>

    <!-- 租客列表 -->
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
      <div v-if="loading" class="p-8 text-center">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        <p class="mt-2 text-gray-600 dark:text-gray-400">加载中...</p>
      </div>

      <div v-else-if="tenants.length === 0" class="p-8 text-center">
        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 class="mt-2 text-sm font-medium text-gray-900 dark:text-white">暂无租客</h3>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">开始添加您的第一个租客吧！</p>
        <div class="mt-6">
          <button @click="showAddModal = true" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition">
            添加租客
          </button>
        </div>
      </div>

      <div v-else>
        <!-- 桌面端表格 -->
        <div class="hidden md:block overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead class="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">租客信息</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">所属房屋</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">租金/支付方式</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">入住日期</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">状态</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-for="tenant in tenants" :key="tenant._id">
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="text-sm font-medium text-gray-900 dark:text-white">{{ tenant.name }}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">身份证: {{ tenant.idCard || '未填写' }}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">手机: {{ tenant.phone || '未填写' }}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="text-sm text-gray-900 dark:text-white">{{ getHouseLabel(tenant.houseId) }}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="text-sm font-medium text-gray-900 dark:text-white">¥{{ tenant.rent || 0 }}/月</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">{{ getPaymentCycleLabel(tenant.paymentCycle) }}</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400" v-if="tenant.deposit">押金: ¥{{ tenant.deposit }}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="text-sm text-gray-900 dark:text-white">{{ formatDate(tenant.moveInDate) }}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <span :class="[
                    'px-2 py-1 text-xs font-medium rounded-full',
                    tenant.status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                    'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
                  ]">
                    {{ tenant.status === 'active' ? '入住中' : '已退租' }}
                  </span>
                  <div v-if="tenant.status === 'moved_out' && (tenant as any).moveOutDate" class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ formatDate((tenant as any).moveOutDate) }} 退租</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <button @click="viewContract(tenant)" class="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 mr-3" title="查看合同">合同</button>
                  <button v-if="tenant.status === 'active'" @click="editTenant(tenant)" class="text-purple-600 dark:text-purple-400 hover:text-purple-900 dark:hover:text-purple-300 mr-3">编辑</button>
                  <button v-if="tenant.status === 'active'" @click="handleMoveOut(tenant)" class="text-orange-600 dark:text-orange-400 hover:text-orange-900 dark:hover:text-orange-300 mr-3">退租</button>
                  <button @click="deleteTenant(tenant._id)" class="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 移动端卡片列表 -->
        <div class="md:hidden space-y-2">
          <div v-for="tenant in tenants" :key="tenant._id" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-3.5 py-3">
            <!-- 第一行：姓名 + 状态 -->
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-bold text-gray-900 dark:text-white">{{ tenant.name }}</span>
                <span :class="['w-2 h-2 rounded-full', tenant.status === 'active' ? 'bg-green-500' : 'bg-gray-400']"></span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs px-2 py-0.5 rounded-full font-medium" :class="tenant.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'">
                  {{ tenant.status === 'active' ? '在住' : '已退' }}
                </span>
                <div v-if="tenant.status === 'moved_out' && (tenant as any).moveOutDate" class="text-[10px] text-gray-400">退{{ formatDate((tenant as any).moveOutDate) }}</div>
              </div>
            </div>
            <!-- 第二行：关键信息 -->
            <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mb-2">
              <span>{{ tenant.phone || '—' }}</span>
              <span class="text-gray-300 dark:text-gray-600">|</span>
              <span>{{ tenant.idCard ? tenant.idCard.slice(-4) : '—' }}</span>
              <span class="text-gray-300 dark:text-gray-600">|</span>
              <span>{{ getHouseLabel(tenant.houseId) }}</span>
            </div>
            <!-- 第三行：操作 -->
            <div class="flex items-center gap-2">
              <button @click="viewContract(tenant)" class="px-2.5 py-1 text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">合同</button>
              <button v-if="tenant.status === 'active'" @click="editTenant(tenant)" class="px-2.5 py-1 text-xs font-medium bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-lg">编辑</button>
              <button v-if="tenant.status === 'active'" @click="handleMoveOut(tenant)" class="px-2.5 py-1 text-xs font-medium bg-orange-50 dark:bg-orange-900/30 text-orange-500 dark:text-orange-400 rounded-lg">退租</button>
              <button @click="deleteTenant(tenant._id)" class="px-2.5 py-1 text-xs font-medium bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400 rounded-lg">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 添加/编辑租客模态框 -->
    <div v-if="showAddModal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div class="relative top-10 mx-auto p-5 border w-full max-w-lg shadow-lg rounded-lg bg-white dark:bg-gray-800">
        <div class="flex justify-between items-center mb-6">
          <h3 class="text-lg font-medium text-gray-900 dark:text-white">{{ editingTenant ? '编辑租客' : '添加租客' }}</h3>
          <button @click="closeModal" class="text-gray-400 hover:text-gray-500">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form @submit.prevent="saveTenant">
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">姓名 <span class="text-red-500">*</span></label>
              <input v-model="tenantForm.name" type="text" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="租客姓名">
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">身份证号 <span class="text-red-500">*</span></label>
              <input v-model="tenantForm.idCard" type="text" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="18位身份证号码">
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">手机号 <span class="text-red-500">*</span></label>
              <input v-model="tenantForm.phone" type="text" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="11位手机号码">
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">所属房屋 <span class="text-red-500">*</span></label>
              <select v-model="tenantForm.houseId" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="">请选择房屋（仅显示可租房源）</option>
                <option v-for="house in availableHousesForRent" :key="house._id" :value="house._id">
                  {{ house.code }} - {{ house.address }}（¥{{ house.rent }}/月）
                </option>
              </select>
              <p v-if="availableHousesForRent.length === 0" class="text-xs text-yellow-600 dark:text-yellow-400 mt-1">暂无可租房屋，请先在房屋管理中添加可租房源。</p>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">月租金（元）</label>
                <input v-model="tenantForm.rent" type="number" required class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">押金（元）</label>
                <input v-model="tenantForm.deposit" type="number" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">租金与水电费支付方式</label>
              <select v-model="tenantForm.paymentCycle" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="month">月付</option>
                <option value="quarter">季付</option>
                <option value="half_year">半年付</option>
                <option value="year">年付</option>
              </select>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">入住日期</label>
                <input v-model="tenantForm.moveInDate" type="date" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">入住电表读数</label>
                <input v-model="tenantForm.moveInElectricity" type="number" step="0.01" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="0">
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">最近一次缴费日期</label>
                <input v-model="tenantForm.lastPaymentDate" type="date" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">用于计算下次收租日的基准日期。如不填写，默认使用入住日期。</p>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">入住水表读数</label>
                <input v-model="tenantForm.moveInWater" type="number" step="0.01" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="0">
              </div>
            </div>
          </div>

          <div class="mt-6 flex justify-end space-x-3">
            <button type="button" @click="closeModal" class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
              取消
            </button>
            <button type="submit" :disabled="saving" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50">
              {{ saving ? '保存中...' : '保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- 添加租客确认模态框 -->
    <div v-if="showConfirmAddModal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div class="relative top-20 mx-auto p-5 border w-full max-w-lg shadow-lg rounded-lg bg-white dark:bg-gray-800">
        <div class="flex justify-between items-center mb-6">
          <h3 class="text-lg font-medium text-gray-900 dark:text-white">确认租客信息</h3>
          <button @click="showConfirmAddModal = false" class="text-gray-400 hover:text-gray-500">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="space-y-4">
          <div class="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <p class="text-yellow-700 dark:text-yellow-300 font-medium">⚠️ 请确认该租客的以下信息</p>
          </div>

          <!-- 租客基本信息 -->
          <div class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 text-sm">
            <div class="flex justify-between py-1">
              <span class="text-gray-500 dark:text-gray-400">姓名</span>
              <span class="text-gray-900 dark:text-white font-medium">{{ tenantForm.name }}</span>
            </div>
            <div class="flex justify-between py-1">
              <span class="text-gray-500 dark:text-gray-400">房屋</span>
              <span class="text-gray-900 dark:text-white font-medium">{{ getHouseLabel(tenantForm.houseId) }}</span>
            </div>
            <div class="flex justify-between py-1">
              <span class="text-gray-500 dark:text-gray-400">入住日期</span>
              <span class="text-gray-900 dark:text-white font-medium">{{ tenantForm.moveInDate }}</span>
            </div>
          </div>

          <!-- 缴费确认 -->
          <div class="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-3">
            <p class="text-blue-700 dark:text-blue-300 font-medium mb-2">💰 缴费确认</p>
            <div class="text-sm space-y-2">
              <div class="flex justify-between text-blue-700 dark:text-blue-300">
                <span>月租金</span>
                <span>¥{{ Number(tenantForm.rent).toFixed(1) }}</span>
              </div>
              <div class="flex justify-between text-blue-700 dark:text-blue-300">
                <span>支付方式</span>
                <span>{{ getPaymentCycleLabel(tenantForm.paymentCycle) }}</span>
              </div>
              <div v-if="tenantForm.paymentCycle === 'quarter'" class="flex justify-between font-medium text-blue-800 dark:text-blue-200 pt-1 border-t border-blue-200 dark:border-blue-700">
                <span>本次应缴租金（季付，3个月）</span>
                <span>¥{{ (Number(tenantForm.rent) * 3).toFixed(1) }}</span>
              </div>
              <div v-if="tenantForm.paymentCycle === 'half_year'" class="flex justify-between font-medium text-blue-800 dark:text-blue-200 pt-1 border-t border-blue-200 dark:border-blue-700">
                <span>本次应缴租金（半年付，6个月）</span>
                <span>¥{{ (Number(tenantForm.rent) * 6).toFixed(1) }}</span>
              </div>
              <div v-if="tenantForm.paymentCycle === 'year'" class="flex justify-between font-medium text-blue-800 dark:text-blue-200 pt-1 border-t border-blue-200 dark:border-blue-700">
                <span>本次应缴租金（年付，12个月）</span>
                <span>¥{{ (Number(tenantForm.rent) * 12).toFixed(1) }}</span>
              </div>
              <div v-if="tenantForm.paymentCycle === 'month'" class="flex justify-between font-medium text-blue-800 dark:text-blue-200 pt-1 border-t border-blue-200 dark:border-blue-700">
                <span>本次应缴租金（月付，1个月）</span>
                <span>¥{{ Number(tenantForm.rent).toFixed(1) }}</span>
              </div>
              <div class="flex justify-between font-medium text-green-700 dark:text-green-300 pt-1 border-t border-blue-200 dark:border-blue-700">
                <span>押金</span>
                <span>¥{{ Number(tenantForm.deposit).toFixed(1) }}</span>
              </div>
              <div class="flex justify-between font-bold text-blue-800 dark:text-blue-200 pt-2 border-t-2 border-blue-300 dark:border-blue-600 text-base">
                <span>合计缴费</span>
                <span>¥{{ (Number(tenantForm.rent) * (tenantForm.paymentCycle === 'quarter' ? 3 : tenantForm.paymentCycle === 'half_year' ? 6 : tenantForm.paymentCycle === 'year' ? 12 : 1) + Number(tenantForm.deposit)).toFixed(1) }}</span>
              </div>
            </div>
          </div>

          <!-- 水电表读数 -->
          <div class="bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 p-3">
            <p class="text-green-700 dark:text-green-300 font-medium mb-2">🔌 入住水电表读数</p>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">电表读数</label>
                <input v-model="tenantForm.moveInElectricity" type="number" step="0.01" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" placeholder="入住时电表度数">
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">水表读数</label>
                <input v-model="tenantForm.moveInWater" type="number" step="0.01" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" placeholder="入住时水表度数">
              </div>
            </div>
          </div>
        </div>

        <div class="mt-6 flex justify-end space-x-3">
          <button type="button" @click="showConfirmAddModal = false" class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
            取消
          </button>
          <button @click="finalizeAddTenant" :disabled="saving" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50">
            {{ saving ? '保存中...' : '确认保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 退租确认模态框 -->
    <div v-if="showMoveOutModal" class="fixed inset-0 bg-gray-600/50 z-50 flex items-end md:items-center justify-center" @click.self="showMoveOutModal = false">
      <div class="w-full md:max-w-md bg-white dark:bg-gray-800 rounded-t-2xl md:rounded-2xl shadow-xl md:max-h-[90vh] max-h-[80vh] flex flex-col">
        <!-- 固定头部 -->
        <div class="flex justify-between items-center p-5 pb-0 shrink-0">
          <h3 class="text-lg font-bold text-gray-900 dark:text-white">办理退租</h3>
          <button @click="showMoveOutModal = false" class="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
            <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <!-- 可滚动内容区域 -->
        <div class="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          <div class="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl border border-yellow-200 dark:border-yellow-800">
            <p class="text-sm text-yellow-700 dark:text-yellow-300 font-medium">
              租客 <strong>{{ moveOutTenant?.name }}</strong> 将从 {{ getHouseLabel(moveOutTenant?.houseId ?? '') }} 退租
            </p>
          </div>

          <div>
            <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">退租日期</label>
            <input v-model="moveOutDate" type="date" class="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">退租电表读数</label>
              <input v-model="moveOutElectricity" type="number" step="0.01" class="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white" :placeholder="'上次缴费读数 ' + (settlementInfo?.baselineElec ?? '—')">
              <p v-if="settlementInfo?.baselineElec" class="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">上次缴费/入住电表读数: {{ settlementInfo.baselineElec }}</p>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">退租水表读数</label>
              <input v-model="moveOutWater" type="number" step="0.01" class="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white" :placeholder="'上次缴费读数 ' + (settlementInfo?.baselineWater ?? '—')">
              <p v-if="settlementInfo?.baselineWater" class="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">上次缴费/入住水表读数: {{ settlementInfo.baselineWater }}</p>
            </div>
          </div>

          <!-- 结算信息 -->
          <div v-if="settlementInfo" class="bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-3 text-sm">
            <p class="font-medium text-blue-700 dark:text-blue-300 mb-2">💡 费用结算预览</p>
            <div class="space-y-1.5 text-blue-600 dark:text-blue-400">
              <p>入住天数: {{ settlementInfo.daysUsed }} 天</p>
              <div class="bg-green-100/60 dark:bg-green-900/20 rounded-lg p-2">
                <p class="font-medium text-green-800 dark:text-green-200 mb-1">📥 已预缴</p>
                <div class="flex justify-between"><span>预缴房租</span><span>¥{{ settlementInfo.prepaidRent?.toFixed(1) }}</span></div>
                <div class="flex justify-between"><span>押金</span><span>¥{{ settlementInfo.depositAmount?.toFixed(1) }}</span></div>
                <div class="flex justify-between font-medium pt-1 border-t border-green-300"><span>小计</span><span>¥{{ ((settlementInfo.prepaidRent||0)+(settlementInfo.depositAmount||0)).toFixed(1) }}</span></div>
              </div>
              <div class="bg-orange-100/60 dark:bg-orange-900/20 rounded-lg p-2">
                <p class="font-medium text-orange-800 dark:text-orange-200 mb-1">📤 应缴费</p>
                <div class="flex justify-between"><span>房租 ({{ settlementInfo.owedRentNote }})</span><span>¥{{ settlementInfo.owedRent?.toFixed(1) }}</span></div>
                <div v-if="settlementInfo.pendingUtility > 0" class="flex justify-between"><span>水电费</span><span>¥{{ settlementInfo.pendingUtility?.toFixed(1) }}</span></div>
                <div class="flex justify-between font-medium pt-1 border-t border-orange-300"><span>小计</span><span>¥{{ ((settlementInfo.owedRent||0)+(settlementInfo.pendingUtility||0)+(settlementInfo.otherPending||0)).toFixed(1) }}</span></div>
              </div>
              <div class="rounded-lg p-2 font-bold" :class="settlementInfo.refundAmount > 0 ? 'bg-green-200/80 dark:bg-green-800/40' : 'bg-red-200/80 dark:bg-red-800/40'">
                <div v-if="settlementInfo.refundAmount > 0" class="flex justify-between"><span class="text-green-800 dark:text-green-200">✅ 最终退费</span><span class="text-green-800 dark:text-green-200">¥{{ settlementInfo.refundAmount?.toFixed(1) }}</span></div>
                <div v-if="settlementInfo.extraDue > 0" class="flex justify-between"><span class="text-red-800 dark:text-red-200">⚠️ 还需缴纳</span><span class="text-red-800 dark:text-red-200">¥{{ settlementInfo.extraDue?.toFixed(1) }}</span></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 固定底部按钮 -->
        <div class="shrink-0 px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex gap-3">
          <button @click="showMoveOutModal = false" class="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 active:bg-gray-50 dark:active:bg-gray-700">取消</button>
          <button @click="confirmMoveOut" :disabled="movingOut || !settlementInfo" class="flex-1 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-medium disabled:opacity-50 active:bg-orange-600">{{ movingOut ? '处理中...' : '确认退租' }}</button>
        </div>
      </div>
    </div>

    <!-- 退租结算确认模态框 -->
    <div v-if="showSettleModal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div class="relative top-20 mx-auto p-5 border w-full max-w-lg shadow-lg rounded-lg bg-white dark:bg-gray-800">
        <div class="flex justify-between items-center mb-6">
          <h3 class="text-lg font-medium text-gray-900 dark:text-white">确认退租结算</h3>
          <button @click="showSettleModal = false" class="text-gray-400 hover:text-gray-500">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="space-y-4">
          <div class="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <p class="text-yellow-700 dark:text-yellow-300 font-medium">⚠️ 请确认该租客的剩余账单已完全结清</p>
          </div>

          <!-- 结算汇总 -->
          <div class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <p class="text-blue-700 dark:text-blue-300 font-medium mb-2">📋 结算账单</p>
            <div class="text-sm space-y-2">
              <div class="flex justify-between text-green-700 dark:text-green-300">
                <span>预缴房租</span>
                <span>¥{{ settlementInfo?.prepaidRent?.toFixed(1) }}</span>
              </div>
              <div class="flex justify-between text-green-700 dark:text-green-300">
                <span>押金</span>
                <span>¥{{ settlementInfo?.depositAmount?.toFixed(1) }}</span>
              </div>
              <div class="flex justify-between text-orange-700 dark:text-orange-300 pt-1 border-t border-blue-200 dark:border-blue-700">
                <span>应缴房租 <span class="text-xs">({{ settlementInfo?.owedRentNote }})</span></span>
                <span>¥{{ settlementInfo?.owedRent?.toFixed(1) }}</span>
              </div>
              <div v-if="settlementInfo?.pendingUtility > 0" class="flex justify-between text-orange-700 dark:text-orange-300">
                <span>水电费</span>
                <span>¥{{ settlementInfo?.pendingUtility?.toFixed(1) }}</span>
              </div>
              <div v-if="settlementInfo?.otherPending > 0" class="flex justify-between text-orange-700 dark:text-orange-300">
                <span>其他费用</span>
                <span>¥{{ settlementInfo?.otherPending?.toFixed(1) }}</span>
              </div>
              <div class="pt-2 border-t-2 border-blue-300 dark:border-blue-600">
                <div v-if="settlementInfo?.refundAmount > 0" class="flex justify-between font-bold text-green-700 dark:text-green-300 text-base">
                  <span>✅ 退费金额</span>
                  <span>¥{{ settlementInfo?.refundAmount?.toFixed(1) }}</span>
                </div>
                <div v-if="settlementInfo?.extraDue > 0" class="flex justify-between font-bold text-red-700 dark:text-red-300 text-base">
                  <span>⚠️ 还需缴纳</span>
                  <span>¥{{ settlementInfo?.extraDue?.toFixed(1) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-6 flex justify-end space-x-3">
          <button @click="showSettleModal = false" class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
            取消
          </button>
          <button @click="finalizeMoveOut" :disabled="movingOut" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50">
            {{ movingOut ? '处理中...' : '确认结清并退租' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { dbService } from '../lib/database'

interface House {
  _id: string
  code: string
  address: string
  rent: number
  status: string
}

interface Tenant {
  _id: string
  name: string
  idCard: string
  phone: string
  houseId: string
  paymentCycle: string
  deposit: number
  rent: number
  moveInDate: Date
  lastPaymentDate?: Date
  status: string
  createdAt: Date
}

const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const movingOut = ref(false)
const showAddModal = ref(false)
const showConfirmAddModal = ref(false)
const showMoveOutModal = ref(false)
const showSettleModal = ref(false)
const editingTenant = ref<Tenant | null>(null)
const moveOutTenant = ref<Tenant | null>(null)
const todayStr = () => new Date().toISOString().slice(0, 10)
const moveOutDate = ref<string>(todayStr())
const moveOutElectricity = ref<number>(0)
const moveOutWater = ref<number>(0)
const settlementInfo = ref<any>(null)

const tenants = ref<Tenant[]>([])
const availableHouses = ref<House[]>([])
const availableHousesForRent = ref<House[]>([])

const filters = ref({
  status: '',
  houseId: '',
  name: ''
})

const tenantForm = ref({
  name: '',
  idCard: '',
  phone: '',
  houseId: '',
  paymentCycle: 'month',
  deposit: 0,
  rent: 0,
  moveInDate: new Date().toISOString().slice(0, 10),
  lastPaymentDate: '',
  moveInElectricity: 0,
  moveInWater: 0
})

const paymentCycleLabels: Record<string, string> = {
  month: '月付',
  quarter: '季付',
  half_year: '半年付',
  year: '年付'
}

const getPaymentCycleLabel = (cycle: string) => {
  return paymentCycleLabels[cycle] || cycle
}

const getHouseLabel = (houseId: string) => {
  const house = availableHouses.value.find(h => h._id === houseId)
  return house ? `${house.code} - ${house.address}` : '未知房屋'
}

const loadTenants = async () => {
  loading.value = true
  try {
    const result = await dbService.getTenants(filters.value)
    tenants.value = result.data
  } catch (error) {
    console.error('加载租客失败:', error)
  } finally {
    loading.value = false
  }
}

const loadHouses = async () => {
  try {
    const allResult = await dbService.getHouses()
    availableHouses.value = allResult.data
    // 可租房源：status为available，或者正在编辑时的当前房屋
    availableHousesForRent.value = allResult.data.filter(
      (h: House) => h.status === 'available'
    )
  } catch (error) {
    console.error('加载房屋失败:', error)
  }
}

// 监听房屋选择自动填充租金
watch(() => tenantForm.value.houseId, (newHouseId) => {
  if (newHouseId && !editingTenant.value) {
    const house = availableHousesForRent.value.find(h => h._id === newHouseId)
    if (house) {
      tenantForm.value.rent = house.rent
    }
  }
})

const saveTenant = async () => {
  if (editingTenant.value) {
    // 编辑租客：直接保存（不弹确认窗）
    saving.value = true
    try {
      await dbService.updateTenant(editingTenant.value._id, tenantForm.value)
      closeModal()
      loadTenants()
      loadHouses()
    } catch (error: any) {
      console.error('保存租客失败:', error)
      alert(error.message || '保存失败，请重试')
    } finally {
      saving.value = false
    }
  } else {
    // 新增租客：弹出确认窗
    showConfirmAddModal.value = true
  }
}

const finalizeAddTenant = async () => {
  saving.value = true
  try {
    await dbService.addTenant(tenantForm.value)
    showConfirmAddModal.value = false
    closeModal()
    loadTenants()
    loadHouses()
  } catch (error: any) {
    console.error('保存租客失败:', error)
    alert(error.message || '保存失败，请重试')
  } finally {
    saving.value = false
  }
}

const editTenant = (tenant: Tenant) => {
  editingTenant.value = tenant
  const tenantAny = tenant as any
  tenantForm.value = {
    name: tenant.name || '',
    idCard: tenant.idCard || '',
    phone: tenant.phone || '',
    houseId: tenant.houseId || '',
    paymentCycle: tenant.paymentCycle || 'month',
    deposit: tenant.deposit || 0,
    rent: tenant.rent || 0,
    moveInDate: tenant.moveInDate ? new Date(tenant.moveInDate).toISOString().slice(0, 10) : '',
    lastPaymentDate: tenantAny.lastPaymentDate ? new Date(tenantAny.lastPaymentDate).toISOString().slice(0, 10) : '',
    moveInElectricity: tenantAny.moveInElectricity || 0,
    moveInWater: tenantAny.moveInWater || 0
  }
  // 重置可租列表为基础状态（仅可租房源），再把当前房屋加进去（编辑时允许保留原房）
  availableHousesForRent.value = availableHouses.value.filter((h: House) => h.status === 'available')
  if (tenant.houseId) {
    const currentHouse = availableHouses.value.find(h => h._id === tenant.houseId)
    if (currentHouse && !availableHousesForRent.value.find(h => h._id === tenant.houseId)) {
      availableHousesForRent.value.push(currentHouse)
    }
  }
  showAddModal.value = true
}

const deleteTenant = async (id: string) => {
  if (confirm('确定要删除这个租客吗？删除后将无法恢复。')) {
    try {
      await dbService.deleteTenant(id)
      loadTenants()
      loadHouses()
    } catch (error) {
      console.error('删除租客失败:', error)
      alert('删除失败，请重试')
    }
  }
}

const handleMoveOut = async (tenant: Tenant) => {
  moveOutTenant.value = tenant
  moveOutDate.value = todayStr()
  moveOutElectricity.value = 0
  moveOutWater.value = 0
  settlementInfo.value = null

  // 加载结算信息
  try {
    const result = await dbService.calculateMoveOutSettlement(tenant._id, new Date(moveOutDate.value))
    settlementInfo.value = result
    // 默认填入基准读数（上次已缴费读数或入住读数），方便房东参考
    moveOutElectricity.value = result.baselineElec ?? 0
    moveOutWater.value = result.baselineWater ?? 0
  } catch (error) {
    console.error('计算结算信息失败:', error)
  }

  showMoveOutModal.value = true
}

// 监听水电表读数变化，实时更新结算中的水电费
watch([moveOutElectricity, moveOutWater], async () => {
  if (!moveOutTenant.value || !settlementInfo.value) return
  // 使用已缴费的基准读数（未缴过则用入住读数）
  const baselineElec = settlementInfo.value.baselineElec ?? ((moveOutTenant.value as any).moveInElectricity || 0)
  const baselineWater = settlementInfo.value.baselineWater ?? ((moveOutTenant.value as any).moveInWater || 0)
  const elecUsed = Math.max(0, Number(moveOutElectricity.value) - baselineElec)
  const waterUsed = Math.max(0, Number(moveOutWater.value) - baselineWater)
  // 使用系统设置中的单价计算，暂时获取不到则使用默认值
  const elecPrice = 0.8
  const waterPrice = 3.5
  const utilityCost = elecUsed * elecPrice + waterUsed * waterPrice
  settlementInfo.value.pendingUtility = utilityCost
  // 重新计算完整结算：总预缴 - 总欠费
  const totalPaid = (settlementInfo.value.prepaidRent || 0) + (settlementInfo.value.depositAmount || 0)
  const totalOwed = (settlementInfo.value.owedRent || 0) + utilityCost + (settlementInfo.value.otherPending || 0)
  const balance = totalPaid - totalOwed
  settlementInfo.value.totalPaid = totalPaid
  settlementInfo.value.totalOwed = totalOwed
  settlementInfo.value.balance = balance
  if (balance >= 0) {
    settlementInfo.value.refundAmount = balance
    settlementInfo.value.extraDue = 0
    settlementInfo.value.settlementLabel = '退费'
  } else {
    settlementInfo.value.refundAmount = 0
    settlementInfo.value.extraDue = -balance
    settlementInfo.value.settlementLabel = '应缴'
  }
})

const confirmMoveOut = async () => {
  if (!moveOutTenant.value) return
  // 先弹出结算确认窗口，由用户确认后再执行退租
  showSettleModal.value = true
}

const finalizeMoveOut = async () => {
  if (!moveOutTenant.value || !settlementInfo.value) return

  movingOut.value = true
  try {
    const houseId = moveOutTenant.value.houseId
    const tenantId = moveOutTenant.value._id
    const moveOutDateObj = new Date(moveOutDate.value)
    const s = settlementInfo.value

    // 1. 如果有水电表读数，创建水电费记录，并同步在缴费记录中生成
    if (Number(moveOutElectricity.value) > 0 || Number(moveOutWater.value) > 0) {
      // 使用已缴费的基准读数（同 watch 逻辑保持一致）
      const baselineElec = s.baselineElec ?? ((moveOutTenant.value as any).moveInElectricity || 0)
      const baselineWater = s.baselineWater ?? ((moveOutTenant.value as any).moveInWater || 0)
      const elecUsed = Math.max(0, Number(moveOutElectricity.value) - baselineElec)
      const waterUsed = Math.max(0, Number(moveOutWater.value) - baselineWater)
      if (elecUsed > 0 || waterUsed > 0) {
        await dbService.addUtilityRecord({
          houseId,
          tenantId,
          electricityReading: Number(moveOutElectricity.value),
          waterReading: Number(moveOutWater.value),
          electricityUsage: elecUsed,
          waterUsage: waterUsed,
          electricityCost: elecUsed * 0.8,
          waterCost: waterUsed * 3.5,
          totalCost: elecUsed * 0.8 + waterUsed * 3.5,
        })
        // 同步到缴费记录
        await dbService.addPayment({
          houseId,
          tenantId,
          paymentType: 'utility',
          amount: elecUsed * 0.8 + waterUsed * 3.5,
          description: `退租结算 - 水电费（电${elecUsed}度×0.8 + 水${waterUsed}吨×3.5）`,
          paymentDate: moveOutDateObj,
          period: `退租结算`,
          status: 'paid'
        })
      }
    }

    // 2. 记录退租结算：退款为负数，补缴为正数
    if (s.refundAmount > 0) {
      // 水电费超出押金的部分从预付租金退款中扣除
      const depositShortfall = Math.max(0, s.pendingUtility - s.depositAmount)
      const rentRefund = Math.max(0, s.prepaidRent - s.owedRent - depositShortfall)
      if (rentRefund > 0) {
        await dbService.addPayment({
          houseId,
          tenantId,
          paymentType: 'rent',
          amount: -rentRefund,
          description: `退租结算 - 退还预付租金（已预付¥${s.prepaidRent.toFixed(1)}，实住应缴¥${s.owedRent.toFixed(1)}）`,
          paymentDate: moveOutDateObj,
          period: `退租结算`,
          status: 'paid'
        })
      }
      const depositRefund = Math.max(0, s.depositAmount - s.pendingUtility)
      if (depositRefund > 0) {
        await dbService.addPayment({
          houseId,
          tenantId,
          paymentType: 'deposit',
          amount: -depositRefund,
          description: `退租结算 - 退还押金（押金¥${s.depositAmount.toFixed(1)}，扣除水电费¥${s.pendingUtility.toFixed(1)}）`,
          paymentDate: moveOutDateObj,
          period: `退租结算`,
          status: 'paid'
        })
      }
    }
    if (s.extraDue > 0) {
      // 还需补缴：记录应收租金
      await dbService.addPayment({
        houseId,
        tenantId,
        paymentType: 'rent',
        amount: s.extraDue,
        description: `退租结算 - 补缴租金（${s.owedRentNote}，预缴已抵扣¥${Math.min(s.prepaidRent, s.owedRent).toFixed(1)}）`,
        paymentDate: moveOutDateObj,
        period: `退租结算`,
        status: 'paid'
      })
    }

    // 4. 执行退租
    await dbService.moveOutTenant(tenantId, moveOutDateObj)
    showSettleModal.value = false
    showMoveOutModal.value = false
    loadTenants()
    loadHouses()
  } catch (error: any) {
    console.error('退租失败:', error)
    alert(error.message || '退租操作失败，请重试')
  } finally {
    movingOut.value = false
  }
}

const viewContract = (tenant: Tenant) => {
  router.push({ path: '/contract', query: { tenantId: tenant._id } })
}

const resetFilters = () => {
  filters.value = { status: '', houseId: '', name: '' }
  loadTenants()
}

const closeModal = () => {
  showAddModal.value = false
  editingTenant.value = null
  tenantForm.value = {
    name: '',
    idCard: '',
    phone: '',
    houseId: '',
    paymentCycle: 'month',
    deposit: 0,
    rent: 0,
    moveInDate: new Date().toISOString().slice(0, 10),
    lastPaymentDate: '',
    moveInElectricity: 0,
    moveInWater: 0
  }
}

const formatDate = (date: Date | string) => {
  if (!date) return '未设置'
  return new Date(date).toLocaleDateString('zh-CN')
}

onMounted(() => {
  loadTenants()
  loadHouses()
})
</script>
