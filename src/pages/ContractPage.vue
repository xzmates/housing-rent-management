<template>
  <div class="container mx-auto max-w-4xl px-4 py-8">
    <!-- 返回按钮 -->
    <div class="mb-6 no-print">
      <button @click="$router.back()" class="flex items-center text-blue-600 dark:text-blue-400 hover:underline">
        <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
        返回
      </button>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="text-center py-16">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      <p class="mt-4 text-gray-600 dark:text-gray-400">加载合同信息中...</p>
    </div>

    <!-- 合同内容 -->
    <div v-else-if="contract" class="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
      <!-- 打印按钮 -->
      <div class="flex justify-end p-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 no-print">
        <button @click="printContract" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center">
          <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          打印合同
        </button>
      </div>

      <!-- 合同正文 -->
      <div class="p-8 md:p-12 contract-content">
        <!-- 合同标题 -->
        <div class="text-center mb-10">
          <h1 class="text-3xl font-bold text-gray-900 dark:text-white mb-2">房屋租赁合同</h1>
          <p class="text-gray-500 dark:text-gray-400 text-sm">合同编号: {{ contract.contractNo }}</p>
          <p class="text-gray-500 dark:text-gray-400 text-sm mt-1">签订日期: {{ contract.signDate }}</p>
        </div>

        <!-- 双方信息 -->
        <div class="mb-8">
          <h2 class="text-lg font-bold text-gray-900 dark:text-white mb-4 pb-2 border-b-2 border-gray-300 dark:border-gray-600">合同双方信息</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <h3 class="font-bold text-blue-700 dark:text-blue-300 mb-3">甲方（出租方）</h3>
              <div class="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                <p><span class="font-medium">姓名：</span>{{ contract.landlord.name }}</p>
                <p><span class="font-medium">联系电话：</span>{{ contract.landlord.phone }}</p>
                <p><span class="font-medium">房屋地址：</span>{{ contract.houseAddress }}</p>
              </div>
            </div>
            <div class="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <h3 class="font-bold text-green-700 dark:text-green-300 mb-3">乙方（承租方）</h3>
              <div class="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                <p><span class="font-medium">姓名：</span>{{ contract.tenant.name }}</p>
                <p><span class="font-medium">身份证号：</span>{{ contract.tenant.idCard }}</p>
                <p><span class="font-medium">联系电话：</span>{{ contract.tenant.phone }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 房屋信息 -->
        <div class="mb-8">
          <h2 class="text-lg font-bold text-gray-900 dark:text-white mb-4 pb-2 border-b-2 border-gray-300 dark:border-gray-600">租赁房屋信息</h2>
          <div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead class="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">项目</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">详情</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <tr>
                  <td class="px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 w-32">房屋编号</td>
                  <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">{{ contract.houseCode }}</td>
                </tr>
                <tr>
                  <td class="px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50">房屋地址</td>
                  <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">{{ contract.houseAddress }}</td>
                </tr>
                <tr>
                  <td class="px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50">入住日期</td>
                  <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">{{ contract.moveInDate }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 租金及支付方式 -->
        <div class="mb-8">
          <h2 class="text-lg font-bold text-gray-900 dark:text-white mb-4 pb-2 border-b-2 border-gray-300 dark:border-gray-600">租金及支付方式</h2>
          <div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead class="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">项目</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">详情</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <tr>
                  <td class="px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 w-32">月租金</td>
                  <td class="px-4 py-3 text-sm text-gray-900 dark:text-white font-bold">¥{{ contract.monthlyRent }} 元/月</td>
                </tr>
                <tr>
                  <td class="px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50">支付方式</td>
                  <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">
                    <span class="px-3 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-xs font-medium">
                      {{ contract.paymentCycleLabel }}
                    </span>
                    <span class="ml-2 text-gray-500 dark:text-gray-400">（每次支付 {{ contract.paymentMonths }} 个月租金，合计 ¥{{ contract.paymentAmount }}）</span>
                  </td>
                </tr>
                <tr>
                  <td class="px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50">押金</td>
                  <td class="px-4 py-3 text-sm text-gray-900 dark:text-white font-bold">¥{{ contract.deposit }} 元</td>
                </tr>
                <tr>
                  <td class="px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50">首次应缴合计</td>
                  <td class="px-4 py-3 text-sm text-red-600 dark:text-red-400 font-bold text-lg">
                    ¥{{ contract.firstPaymentTotal }} 元
                    <span class="text-xs text-gray-500 dark:text-gray-400 ml-2">（押金 ¥{{ contract.deposit }} + 首期租金 ¥{{ contract.paymentAmount }}）</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 合同条款 -->
        <div class="mb-8">
          <h2 class="text-lg font-bold text-gray-900 dark:text-white mb-4 pb-2 border-b-2 border-gray-300 dark:border-gray-600">合同条款</h2>
          <div class="space-y-4 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
            <div class="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
              <p class="font-medium mb-1">第一条 租赁期限</p>
              <p>本合同为定期租赁合同，租赁期限自 {{ contract.moveInDate }} 起算。双方如需提前终止合同，应提前30天书面通知对方。</p>
            </div>
            <div class="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
              <p class="font-medium mb-1">第二条 租金及支付</p>
              <p>乙方应按照{{ contract.paymentCycleLabel }}方式支付租金，每次支付 ¥{{ contract.paymentAmount }} 元。租金应于每期开始前5日内支付。如逾期支付，每逾期一日应按应付租金的5‰支付违约金。</p>
            </div>
            <div class="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
              <p class="font-medium mb-1">第三条 押金</p>
              <p>乙方于签订本合同时向甲方支付押金 ¥{{ contract.deposit }} 元。合同期满，乙方无违约行为且房屋及设施无人为损坏的，甲方应在乙方退租后7日内无息退还押金。</p>
            </div>
            <div class="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
              <p class="font-medium mb-1">第四条 房屋使用</p>
              <p>乙方应合理使用并爱护房屋及附属设施，不得擅自改变房屋结构或用途。因乙方使用不当造成房屋或设施损坏的，乙方应负责维修或赔偿。</p>
            </div>
            <div class="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
              <p class="font-medium mb-1">第五条 水电费用</p>
              <p>租赁期间的水费、电费由乙方承担，按实际用量及当地收费标准计算缴纳。</p>
            </div>
          </div>
        </div>

        <!-- 签字区 -->
        <div class="mt-12 pt-8 border-t-2 border-gray-300 dark:border-gray-600">
          <div class="grid grid-cols-2 gap-12">
            <div class="text-center">
              <p class="font-bold text-gray-900 dark:text-white mb-8">甲方（出租方）签字：</p>
              <p class="text-gray-500 dark:text-gray-400 text-sm">日期：{{ contract.signDate }}</p>
            </div>
            <div class="text-center">
              <p class="font-bold text-gray-900 dark:text-white mb-8">乙方（承租方）签字：</p>
              <p class="text-gray-500 dark:text-gray-400 text-sm">日期：{{ contract.signDate }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 未找到合同 -->
    <div v-else class="text-center py-16 bg-white dark:bg-gray-800 rounded-lg shadow-md">
      <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <h3 class="mt-2 text-sm font-medium text-gray-900 dark:text-white">未找到合同信息</h3>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">请确认租客信息是否存在</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { dbService } from '../lib/database'

const route = useRoute()
const loading = ref(true)
const contract = ref<any>(null)

const paymentCycleLabels: Record<string, string> = {
  month: '月付',
  quarter: '季付',
  half_year: '半年付',
  year: '年付'
}

const loadContract = async () => {
  loading.value = true
  try {
    const tenantId = route.query.tenantId as string
    if (!tenantId) {
      loading.value = false
      return
    }

    // 获取租客信息
    const tenantResult = await dbService.getTenants()
    const tenant = (tenantResult.data as any[]).find((t: any) => t._id === tenantId)
    if (!tenant) {
      loading.value = false
      return
    }

    // 获取房屋信息
    const houseResult = await dbService.getHouses()
    const house = (houseResult.data as any[]).find((h: any) => h._id === tenant.houseId)

    const cycle = tenant.paymentCycle || 'month'
    const cycleMonths: Record<string, number> = {
      month: 1, quarter: 3, half_year: 6, year: 12
    }
    const paymentMonths = cycleMonths[cycle] || 1
    const monthlyRent = tenant.rent || house?.rent || 0
    const paymentAmount = monthlyRent * paymentMonths
    const deposit = tenant.deposit || 0
    const moveInDate = tenant.moveInDate ? new Date(tenant.moveInDate) : new Date()
    const contractDate = moveInDate

    contract.value = {
      contractNo: `HT-${contractDate.getFullYear()}${String(contractDate.getMonth() + 1).padStart(2, '0')}${String(contractDate.getDate()).padStart(2, '0')}-${tenantId.substring(0, 6)}`,
      signDate: contractDate.toLocaleDateString('zh-CN'),
      houseCode: house?.code || '未知',
      houseAddress: house?.address || '未知',
      moveInDate: tenant.moveInDate ? new Date(tenant.moveInDate).toLocaleDateString('zh-CN') : '未设置',
      monthlyRent,
      paymentCycle: cycle,
      paymentCycleLabel: paymentCycleLabels[cycle] || cycle,
      paymentMonths,
      paymentAmount,
      deposit,
      firstPaymentTotal: deposit + paymentAmount,
      landlord: {
        name: '房东姓名',
        phone: '请填写联系电话'
      },
      tenant: {
        name: tenant.name,
        idCard: tenant.idCard || '未填写',
        phone: tenant.phone || '未填写'
      }
    }
  } catch (error) {
    console.error('加载合同信息失败:', error)
  } finally {
    loading.value = false
  }
}

const printContract = () => {
  window.print()
}

onMounted(() => {
  loadContract()
})
</script>

<style scoped>
@media print {
  .no-print {
    display: none !important;
  }
  body {
    background: white !important;
  }
  .contract-content {
    padding: 0 !important;
  }
}
</style>
