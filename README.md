# 房屋租赁管理系统

基于CloudBase云开发的房屋租赁管理系统，包含房屋管理、租客管理、缴费记录、水电费计算和系统设置等功能。

## 🚀 功能特性

### 核心功能
- **房屋管理**: 添加、编辑、删除、筛选房屋信息
- **租客管理**: 管理租客信息，支持退租操作
- **缴费记录**: 租金、水电费、押金等缴费管理
- **水电费计算**: 自动计算水电费并生成缴费记录
- **系统设置**: 水电单价设置和系统配置管理

### 技术特性
- **前端**: Vue 3 + TypeScript + Vite
- **后端**: CloudBase云开发平台
- **数据库**: CloudBase NoSQL文档数据库
- **样式**: Tailwind CSS + DaisyUI
- **响应式**: 支持移动端和桌面端
- **主题**: 支持亮色/暗色模式切换

## 📁 项目结构

\`\`\`
src/
├── components/          # 公共组件
│   ├── AppNavbar.vue    # 导航栏组件
│   └── HomeFooter.vue   # 页脚组件
├── pages/              # 页面组件
│   ├── HomePage.vue    # 首页
│   ├── DashboardPage.vue # 仪表盘
│   ├── HousesPage.vue  # 房屋管理
│   ├── TenantsPage.vue # 租客管理
│   ├── PaymentsPage.vue # 缴费记录
│   ├── UtilityPage.vue # 水电费计算
│   └── SettingsPage.vue # 系统设置
├── lib/                # 工具库
│   └── database.ts     # 数据库服务类
├── utils/              # 工具函数
│   └── cloudbase.ts    # CloudBase初始化配置
└── main.ts            # 应用入口文件
\`\`\`

## 🛠️ 快速开始

### 环境要求
- Node.js 16+
- npm 或 yarn

### 安装依赖
\`\`\`bash
npm install
\`\`\`

### 开发环境配置

1. 创建 \`.env\` 文件：
\`\`\`bash
cp .env.example .env
\`\`\`

2. 编辑 \`.env\` 文件，配置你的CloudBase环境：
\`\`\`env
VITE_ENV_ID=your-environment-id
VITE_PUBLISHABLE_KEY=your-publishable-key
\`\`\`

### 获取环境配置

1. 登录 [CloudBase控制台](https://tcb.cloud.tencent.com)
2. 创建或选择已有的环境
3. 在**环境设置**中获取 **环境ID**
4. 在**身份认证** → **登录设置** → **网页应用**中获取 **Publishable Key**

### 启动开发服务器
\`\`\`bash
npm run dev
\`\`\`

访问 \`http://localhost:5173\` 查看应用。

## 📦 构建与部署

### 构建生产版本
\`\`\`bash
npm run build
\`\`\`

构建产物将生成在 \`dist/\` 目录。

### 部署到CloudBase

#### 方法一：使用CloudBase控制台
1. 登录 [CloudBase控制台](https://tcb.cloud.tencent.com)
2. 选择对应的环境
3. 进入**静态网站托管**模块
4. 上传 \`dist/\` 目录中的文件

#### 方法二：使用CloudBase CLI
\`\`\`bash
# 全局安装CloudBase CLI
npm install -g @cloudbase/cli

# 登录
tcb login

# 部署
tcb hosting:deploy dist -e your-env-id
\`\`\`

### 部署结果

本项目已成功部署到CloudBase静态托管，可通过以下地址访问：

🔗 **在线访问地址**: https://housing-rent-management-401848f6-1422728060.tcloudbaseapp.com

> 💡 **CDN缓存提示**: 如页面未更新，可在URL后添加随机参数如 `?v=1` 或使用浏览器无痕模式访问。CDN通常在数分钟内自动刷新。

**访问说明**:
- ✅ 支持电脑浏览器访问
- ✅ 支持手机浏览器访问
- ✅ 支持微信内打开（无需下载）
- 📱 移动端自动适配，操作流畅

**数据库状态**: 
- 系统首次访问时会尝试自动创建所需的数据库集合
- 如果自动创建失败，请手动创建以下5个集合：
  1. `houses` - 房屋信息
  2. `tenants` - 租客信息  
  3. `payments` - 缴费记录
  4. `utility_records` - 水电费记录
  5. `system_settings` - 系统设置

**手动创建数据库集合步骤**:
1. 登录 [CloudBase控制台](https://tcb.cloud.tencent.com/dev?envId=housing-rent-management-401848f6#/db/doc)
2. 点击"创建集合"按钮
3. 输入集合名称（如上所列）
4. 点击确定
5. 刷新应用页面

**权限设置建议**:
- 所有集合建议设置为"读取全部数据，修改本人数据"（适合管理后台）
- 或根据实际需求设置其他权限级别

### 🆕 新增功能（最新版本）

#### 1. 房屋绑定限制
- ✅ 每栋房子只能绑定 **一名活跃租客**
- ✅ 添加租客时自动检查房屋是否已有租客
- ✅ 编辑租客时验证房屋占用状态

#### 2. 智能房屋筛选
- ✅ 添加租客时，房屋下拉列表只显示 **可租** 的房屋
- ✅ 已租房屋不会出现在可选列表中

#### 3. 起缴支付系统
- ✅ **支付方式**: 押一付一、押一付二、押一付三、押一付六、押一付十二
- ✅ **缴费周期**: 月、季度、半年、一年
- ✅ 自动计算押金和租金金额
- ✅ 自动生成初始缴费记录

#### 4. 智能收租计算
- ✅ 根据缴费周期自动计算下次收租日期
- ✅ 房屋管理页面显示下次收租时间和金额
- ✅ 支持不同缴费周期的租金计算

---

## ☁️ 云开发资源

本项目使用以下腾讯云CloudBase资源：

| 资源类型 | 用途说明 | 控制台入口 |
|---------|---------|-----------|
| **CloudBase环境** | 整体运行环境，包含所有服务 | [环境管理](https://tcb.cloud.tencent.com/dev?envId=housing-rent-management-401848f6#/overview) |
| **静态网站托管** | 前端页面托管和CDN加速 | [静态托管](https://tcb.cloud.tencent.com/dev?envId=housing-rent-management-401848f6#/static-hosting) |
| **NoSQL文档数据库** | 存储房屋、租客、缴费等数据 | [文档数据库](https://tcb.cloud.tencent.com/dev?envId=housing-rent-management-401848f6#/db/doc) |
| **身份认证** | 匿名登录支持 | [身份认证](https://tcb.cloud.tencent.com/dev?envId=housing-rent-management-401848f6#/identity/login-manage) |
| **云函数** | （可选）未来可扩展后端逻辑 | [云函数](https://tcb.cloud.tencent.com/dev?envId=housing-rent-management-401848f6#/scf) |

**环境ID**: `housing-rent-management-401848f6`

---

## 🔧 数据库结构

系统使用CloudBase NoSQL文档数据库，包含以下集合：

### 1. \`houses\` - 房屋信息
\`\`\`typescript
{
  _id: string
  address: string        // 房屋地址
  layout: string         // 户型
  area: number          // 面积（平方米）
  rent: number          // 月租金
  status: 'available' | 'rented' | 'maintenance'
  description: string   // 描述
  createdAt: Date
  updatedAt: Date
}
\`\`\`

### 2. \`tenants\` - 租客信息
\`\`\`typescript
{
  _id: string
  name: string          // 租客姓名
  idCard: string        // 身份证号
  phone: string        // 手机号码
  email: string        // 邮箱
  houseId: string      // 所属房屋ID
  contractNumber: string // 合同编号
  moveInDate: Date     // 入住日期
  moveOutDate?: Date   // 退租日期
  status: 'active' | 'moved_out'
  notes: string        // 备注
  paymentType?: string // 支付方式: deposit_one_pay_one, deposit_one_pay_two, deposit_one_pay_three, deposit_one_pay_six, deposit_one_pay_twelve
  paymentCycle?: string // 缴费周期: month, quarter, half_year, year
  createdAt: Date
  updatedAt: Date
}
\`\`\`

### 3. \`payments\` - 缴费记录
\`\`\`typescript
{
  _id: string
  houseId: string      // 房屋ID
  tenantId: string     // 租客ID
  paymentType: 'rent' | 'utility' | 'deposit' | 'other'
  amount: number       // 金额
  paymentDate: Date    // 缴费日期
  period: string       // 缴费周期（如：2024-05）
  description: string  // 描述
  status: 'paid' | 'pending' | 'overdue'
  createdAt: Date
  updatedAt: Date
}
\`\`\`

### 4. \`utility_records\` - 水电费记录
\`\`\`typescript
{
  _id: string
  houseId: string      // 房屋ID
  tenantId: string     // 租客ID
  electricityReading: number // 电表读数（度）
  waterReading: number      // 水表读数（吨）
  electricityUsage: number  // 用电量
  waterUsage: number       // 用水量
  electricityCost: number  // 电费
  waterCost: number       // 水费
  totalCost: number       // 总费用
  calculationDate: Date   // 计算日期
  createdAt: Date
}
\`\`\`

### 5. \`system_settings\` - 系统设置
\`\`\`typescript
{
  _id: string
  electricityPrice: number // 电费单价（元/度）
  waterPrice: number      // 水费单价（元/吨）
  updatedAt: Date
}
\`\`\`

## 🔐 身份认证

系统使用CloudBase内置的匿名登录功能：

1. **自动登录**: 用户首次访问时自动匿名登录
2. **无密码**: 无需用户输入账号密码
3. **用户标识**: 每个浏览器会生成唯一的匿名用户ID

如果需要其他登录方式（手机号、邮箱、微信等），可在CloudBase控制台配置。

## 🌐 API接口

所有数据库操作通过 \`@cloudbase/js-sdk\` 直接调用CloudBase服务：

\`\`\`typescript
// 数据库服务类
import { dbService } from './lib/database'

// 房屋管理
dbService.getHouses()
dbService.addHouse(data)
dbService.updateHouse(id, data)
dbService.deleteHouse(id)

// 租客管理
dbService.getTenants()
dbService.addTenant(data)
dbService.updateTenant(id, data)
dbService.moveOutTenant(id, date)

// 缴费记录
dbService.getPayments()
dbService.addPayment(data)
dbService.updatePayment(id, data)
dbService.deletePayment(id)

// 水电费计算
dbService.calculateUtilityBill(houseId, tenantId, electricity, water)

// 系统设置
dbService.getSystemSettings()
dbService.updateSystemSettings(data)
\`\`\`

## 🎨 主题定制

### 深色模式
- 右上角提供深色/浅色模式切换按钮
- 使用\`localStorage\`保存用户偏好
- 支持系统自动检测

### 自定义样式
1. 修改 \`tailwind.config.js\` 中的主题配置
2. 添加自定义CSS到 \`src/style.css\`
3. 使用DaisyUI主题系统

## 📱 移动端适配

系统采用响应式设计，支持：
- 桌面端：多栏布局，完整功能
- 平板端：优化布局，保留主要功能
- 手机端：单栏布局，简化操作

## 🔧 开发指南

### 添加新页面
1. 在 \`src/pages/\` 中创建Vue组件
2. 在 \`src/main.ts\` 中添加路由
3. 在 \`AppNavbar.vue\` 中添加导航链接

### 扩展数据库
1. 在 \`src/lib/database.ts\` 中添加新的集合常量
2. 实现对应的CRUD操作方法
3. 在需要的地方调用新方法

### 调试技巧
- 使用浏览器的开发者工具查看CloudBase SDK日志
- 检查网络请求中的CloudBase API调用
- 使用Vue Devtools检查组件状态

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (\`git checkout -b feature/AmazingFeature\`)
3. 提交更改 (\`git commit -m 'Add some AmazingFeature'\`)
4. 推送到分支 (\`git push origin feature/AmazingFeature\`)
5. 开启 Pull Request

## 📄 许可证

本项目基于 MIT 许可证开源。

## 📞 支持与反馈

如有问题或建议，请通过以下方式联系我们：

1. 提交 Issues
2. 查阅 [CloudBase官方文档](https://cloud.tencent.com/product/tcb)
3. 加入CloudBase开发者社区

---

**Powered by CloudBase + Vue 3**
