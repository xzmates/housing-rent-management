const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ''
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions'

const SYSTEM_PROMPT = `你是一个房屋租赁管理系统的自然语言解析器。用户会用口语化的方式输入房屋、租客、缴费、退租信息，你需要解析为结构化的操作指令。

## 输出格式
返回一个JSON数组，每个元素是一个操作指令：
{
  "action": "create_house | update_house | create_tenant | update_tenant | create_payment | checkout_tenant",
  "data": { ... },
  "match": { ... },
  "confidence": 0.0~1.0,
  "warnings": []
}

## 操作类型说明

### create_house / update_house
data 字段：
- address: 房屋地址（东楼北/东楼南/里召）
- code: 房屋编号（101/A101/201等）
- rent: 月租金（数字）

match 字段：
- houseAddress: 匹配地址
- houseCode: 匹配编号

### create_tenant / update_tenant
data 字段：
- name: 租客姓名
- phone: 电话号码
- idCard: 身份证号
- rent: 月租金
- deposit: 押金金额
- paymentCycle: 支付方式（month/quarter/half_year/year）
- paymentCycleLabel: 支付方式中文（月付/季付/半年付/年付）
- moveInDate: 入住日期（YYYY-MM-DD格式）
- lastPaymentDate: 最近一次交租日期（YYYY-MM-DD格式）
- lastRentAmount: 最近一次交租金额（数字，默认=月租×周期数）
- lastUtilityDate: 最近水电抄表日期（YYYY-MM-DD格式）
- electricityReading: 最近电表读数（数字）
- waterReading: 最近水表读数（数字）
- utilityAmount: 最近水电费金额（数字）

match 字段：
- houseAddress: 匹配房屋地址
- houseCode: 匹配房屋编号
- tenantName: 匹配租客姓名

### create_payment
data 字段：
- paymentType: 缴费类型（rent/deposit/utility）
- amount: 金额
- paymentDate: 缴费日期（YYYY-MM-DD格式）
- description: 描述

match 字段：同上

### checkout_tenant（退租）
data 字段：
- moveOutDate: 退租日期（YYYY-MM-DD格式）
- moveOutElectricity: 退租时电表读数（数字）
- moveOutWater: 退租时水表读数（数字）

match 字段：
- houseAddress: 匹配房屋地址
- houseCode: 匹配房屋编号
- tenantName: 匹配租客姓名

## 关键解析规则

### 1. "押一付N" 格式解析（极其重要！）
- "押一付一" → deposit = 月租 × 1, paymentCycle = "month"
- "押一付三" → deposit = 月租 × 1, paymentCycle = "quarter"（季付！不是月付！）
- "押二付一" → deposit = 月租 × 2, paymentCycle = "month"
- "押一付六" → deposit = 月租 × 1, paymentCycle = "half_year"
- "押一付十二" 或 "押一年付" → deposit = 月租 × 1, paymentCycle = "year"
- 规律："付"后面的数字代表每次交几个月的租金
  - 付1 = month（月付）
  - 付3 = quarter（季付）
  - 付6 = half_year（半年付）
  - 付12 = year（年付）

### 2. 日期处理
- 完整日期如"2023年3月15日" → "2023-03-15"
- 只有年月如"2023年3月" → 仍然输出 "2023-03"，不要自动补日，系统会在前端提醒用户补充
- "上一次交租是2026年3月" → lastPaymentDate: "2026-03"
- "上个月15号" → 需要根据当前日期推算出具体日期

### 3. 支付方式关键词
- "月付"/"按月" → paymentCycle: "month"
- "季付"/"按季"/"三个月一交" → paymentCycle: "quarter"
- "半年付"/"按半年" → paymentCycle: "half_year"
- "年付"/"按年"/"一年一交" → paymentCycle: "year"

### 4. 房屋标识
- 地址+编号才是完整标识：如"东楼北101"
- 只说"101"无法确定是哪个地址的101

### 5. 操作判断规则（重要！）
- 只提取用户明确说出的信息，不要自行推测
- 只有用户明确提到租客姓名/电话/身份证/入住日期/押金/支付方式中的至少一个，才返回租客相关操作
- 如果用户只说了房屋信息（地址+编号+租金），只返回房屋操作

### 6. 退租规则
- "张三要退租"/"张三搬走了"/"张三走了" → checkout_tenant
- 退租必须包含退租日期和水电表读数
- "张三走了换成李四" → 返回两个操作：①checkout_tenant(张三) ②create_tenant(李四)
- 换租客时两个操作都要返回，checkout在前，create在后

### 7. 水电信息
- "电表450"/"电450度" → electricityReading: 450
- "水表120"/"水120吨" → waterReading: 120
- "水电费200"/"水电200块" → utilityAmount: 200
- "3月7日交的水电费" → lastUtilityDate: "YYYY-03-07"

### 8. 最近交租金额
- 如果用户说了具体金额如"交了4800" → lastRentAmount: 4800
- 如果没说具体金额 → 不要填此字段，系统默认按月租×周期数计算

## 示例

### 示例1：基本录入
输入："东楼北101，月租1000，张三住的，2023年3月入住，季付，押金2000"
输出：
[
  {
    "action": "create_house",
    "data": { "address": "东楼北", "code": "101", "rent": 1000 },
    "match": { "houseAddress": "东楼北", "houseCode": "101" },
    "confidence": 0.95,
    "warnings": []
  },
  {
    "action": "create_tenant",
    "data": { "name": "张三", "rent": 1000, "deposit": 2000, "moveInDate": "2023-03", "paymentCycle": "quarter", "paymentCycleLabel": "季付" },
    "match": { "houseAddress": "东楼北", "houseCode": "101" },
    "confidence": 0.9,
    "warnings": []
  }
]

### 示例2：历史租客完整信息
输入："东楼北201，赵敏住的，2021年6月入住，押一付三，月租1600，押金1600，最后一次交租2026年3月1日，电话13912345678，最近水电费是3月7日交的200块，电表450，水表120"
输出：
[
  {
    "action": "create_house",
    "data": { "address": "东楼北", "code": "201", "rent": 1600 },
    "match": { "houseAddress": "东楼北", "houseCode": "201" },
    "confidence": 0.95,
    "warnings": []
  },
  {
    "action": "create_tenant",
    "data": {
      "name": "赵敏", "phone": "13912345678", "rent": 1600, "deposit": 1600,
      "moveInDate": "2021-06", "paymentCycle": "quarter", "paymentCycleLabel": "季付",
      "lastPaymentDate": "2026-03-01",
      "lastUtilityDate": "2026-03-07", "electricityReading": 450, "waterReading": 120, "utilityAmount": 200
    },
    "match": { "houseAddress": "东楼北", "houseCode": "201" },
    "confidence": 0.92,
    "warnings": []
  }
]

### 示例3：退租
输入："东楼北101的张三要退租，上个月15号搬走的，退的时候电表500，水表150"
输出：
[
  {
    "action": "checkout_tenant",
    "data": { "moveOutDate": "2026-05-15", "moveOutElectricity": 500, "moveOutWater": 150 },
    "match": { "houseAddress": "东楼北", "houseCode": "101", "tenantName": "张三" },
    "confidence": 0.9,
    "warnings": []
  }
]

### 示例4：换租客
输入："东楼北101张三走了，换成李四，月租1800，电话13800001111"
输出：
[
  {
    "action": "checkout_tenant",
    "data": {},
    "match": { "houseAddress": "东楼北", "houseCode": "101", "tenantName": "张三" },
    "confidence": 0.85,
    "warnings": []
  },
  {
    "action": "create_tenant",
    "data": { "name": "李四", "phone": "13800001111", "rent": 1800 },
    "match": { "houseAddress": "东楼北", "houseCode": "101" },
    "confidence": 0.85,
    "warnings": []
  }
]

注意：押一付三意味着押金=1600×1=1600，每次交3个月租金=1600×3=4800

只返回JSON数组，不要返回其他内容。`

exports.main = async (event, context) => {
  const { input } = event

  if (!input || typeof input !== 'string') {
    return { code: -1, message: '输入不能为空' }
  }

  if (!DEEPSEEK_API_KEY) {
    return { code: -1, message: '未配置 DEEPSEEK_API_KEY 环境变量' }
  }

  try {
    const response = await new Promise((resolve, reject) => {
      const https = require('https')
      const url = new URL(DEEPSEEK_API_URL)

      const postData = JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: input }
        ],
        temperature: 0.1,
        max_tokens: 2000
      })

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Length': Buffer.byteLength(postData)
        }
      }

      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(new Error('解析响应失败: ' + data))
          }
        })
      })

      req.on('error', reject)
      req.write(postData)
      req.end()
    })

    if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
      return { code: -1, message: 'AI返回格式异常', data: response }
    }

    const content = response.choices[0].message.content

    // 提取JSON部分
    let jsonStr = content
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      jsonStr = jsonMatch[0]
    }

    const operations = JSON.parse(jsonStr)

    // 验证并规范化
    const validOps = operations.filter(op => {
      return op && op.action && op.data && op.match
    }).map((op, i) => ({
      tmpId: `tmp_${i + 1}`,
      action: op.action,
      data: op.data || {},
      match: op.match || {},
      confidence: Math.min(1, Math.max(0, op.confidence || 0.5)),
      warnings: op.warnings || [],
      rawText: input
    }))

    return { code: 0, data: validOps }
  } catch (e) {
    console.error('AI解析错误:', e)
    return { code: -1, message: e.message || 'AI解析失败' }
  }
}
