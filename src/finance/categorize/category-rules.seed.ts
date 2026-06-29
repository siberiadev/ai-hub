import type {
  BankSource,
  CategoryKind,
  RuleType,
  TxnClass,
} from '../finance.types';

/* Единый источник сид-данных для миграции FinanceInit. Порт schema.sql (accounts,
 * fx_rates, categories) + load.py (CAT_RULES, INCOME_*, TRANSFER_KW) + reclassify.sql
 * (ручные override-правила). Сервис категоризации читает их уже из таблиц БД. */

export interface SeedAccount {
  source: BankSource;
  bank: string;
  accountNo: string | null;
  baseCurrency: string;
  label: string;
}

export const SEED_ACCOUNTS: SeedAccount[] = [
  {
    source: 'mox',
    bank: 'Mox Bank',
    accountNo: '389-74952941784',
    baseCurrency: 'HKD',
    label: 'HKD Mox Account (debit card)',
  },
  {
    source: 'standard_chartered',
    bank: 'Standard Chartered',
    accountNo: '407-8-136763-1',
    baseCurrency: 'HKD',
    label: 'Integrated Deposits (HKD/CNY/GBP)',
  },
  {
    source: 'alipay',
    bank: 'Alipay HK',
    accountNo: null,
    baseCurrency: 'HKD',
    label: 'Alipay HK wallet',
  },
];

export interface SeedFxRate {
  currency: string;
  toHkd: number;
  note: string;
}

/** Приблизительные курсы native→HKD (HKD=1). Порт fx_rates из schema.sql. */
export const SEED_FX_RATES: SeedFxRate[] = [
  { currency: 'HKD', toHkd: 1.0, note: 'base' },
  { currency: 'GBP', toHkd: 10.5, note: 'approx; SC GBP HKD-equiv ~10.5' },
  { currency: 'CNY', toHkd: 1.07, note: 'approx' },
  { currency: 'USD', toHkd: 7.8, note: 'approx HKD peg' },
  { currency: 'EUR', toHkd: 8.5, note: 'approx' },
  { currency: 'JPY', toHkd: 0.052, note: 'approx' },
  { currency: 'THB', toHkd: 0.22, note: 'approx' },
  { currency: 'KZT', toHkd: 0.016, note: 'approx' },
];

export interface SeedCategory {
  name: string;
  kind: CategoryKind;
}

export const SEED_CATEGORIES: SeedCategory[] = [
  { name: 'Rent / Housing', kind: 'expense' },
  { name: 'Sports & Fitness', kind: 'expense' },
  { name: 'Groceries', kind: 'expense' },
  { name: 'Dining & Cafe', kind: 'expense' },
  { name: 'Transport', kind: 'expense' },
  { name: 'Shopping & Retail', kind: 'expense' },
  { name: 'Entertainment & Leisure', kind: 'expense' },
  { name: 'Health & Pharmacy', kind: 'expense' },
  { name: 'Utilities & Telecom', kind: 'expense' },
  { name: 'Travel', kind: 'expense' },
  { name: 'Education', kind: 'expense' },
  { name: 'Services & Office', kind: 'expense' },
  { name: 'Convenience Store', kind: 'expense' },
  { name: 'Cash & ATM', kind: 'expense' },
  { name: 'Cash & FX (spent)', kind: 'expense' },
  { name: 'Fees & Charges', kind: 'expense' },
  { name: 'Family / Wife', kind: 'expense' },
  { name: 'Other / Uncategorized', kind: 'expense' },
  { name: 'Salary', kind: 'income' },
  { name: 'Interest', kind: 'income' },
  { name: 'Cashback', kind: 'income' },
  { name: 'Other income', kind: 'income' },
  { name: 'Internal transfer', kind: 'transfer' },
  { name: 'Alipay funding', kind: 'transfer' },
  { name: 'Investments / Brokerage', kind: 'transfer' },
];

export const UNCATEGORIZED = 'Other / Uncategorized';

export interface SeedRule {
  priority: number;
  ruleType: RuleType;
  pattern: string;
  /** Для override/category — целевая категория. */
  category: string | null;
  /** Для income/override — присваиваемый txn_class. */
  txnClass: TxnClass | null;
}

/**
 * Правила в порядке применения. priority уникален и задаёт глобальный порядок;
 * сервис фильтрует по ruleType и сортирует по priority.
 *
 * override (1–49) — ручные правила (reclassify.sql): ставят и класс, и категорию,
 *   побеждают над income/transfer. Напр. перевод жене Olga → расход Family/Wife.
 * income (50–59), transfer (60–69) — порт INCOME/TRANSFER keywords.
 * category (100+) — порт CAT_RULES (расходный мерчант, первое совпадение).
 */
export const SEED_RULES: SeedRule[] = [
  // ---- override (reclassify.sql) ----
  {
    priority: 1,
    ruleType: 'override',
    pattern: 'OLGA',
    category: 'Family / Wife',
    txnClass: 'expense',
  },
  {
    priority: 2,
    ruleType: 'override',
    pattern: 'LANDLORD|MEI TING|NANCY|業主',
    category: 'Rent / Housing',
    txnClass: 'expense',
  },
  {
    priority: 3,
    ruleType: 'override',
    pattern: '\\bSWIM\\b|SWIMMING|游泳|JUMANJI|ALIAKSANDRA|SASHA',
    category: 'Sports & Fitness',
    txnClass: 'expense',
  },
  {
    priority: 4,
    ruleType: 'override',
    pattern: 'INTERACTIVE BROKERS',
    category: 'Investments / Brokerage',
    txnClass: 'transfer_out',
  },
  {
    priority: 5,
    ruleType: 'override',
    pattern: 'ZHONGMIANJITUAN',
    category: 'Travel',
    txnClass: 'expense',
  },
  {
    priority: 6,
    ruleType: 'override',
    pattern: 'CASH WITHDRAWAL',
    category: 'Cash & FX (spent)',
    txnClass: 'expense',
  },
  {
    priority: 7,
    ruleType: 'override',
    pattern: 'KANGAROO',
    category: 'Dining & Cafe',
    txnClass: 'expense',
  },
  {
    priority: 8,
    ruleType: 'override',
    pattern: 'TRADEINN|CURRENTBODY',
    category: 'Shopping & Retail',
    txnClass: 'expense',
  },

  // ---- income (INCOME_* из load.py) ----
  {
    priority: 50,
    ruleType: 'income',
    pattern: 'DEEL|SALARY|薪[金⾦]|SALARYDEEL|ST3 GROUP',
    category: null,
    txnClass: 'income_salary',
  },
  {
    priority: 51,
    ruleType: 'income',
    pattern: 'INTEREST|利息',
    category: null,
    txnClass: 'income_interest',
  },
  {
    priority: 52,
    ruleType: 'income',
    pattern: 'CASHBACK',
    category: null,
    txnClass: 'income_cashback',
  },

  // ---- transfer (TRANSFER_KW) ----
  {
    priority: 60,
    ruleType: 'transfer',
    pattern:
      'WISE PAYMENTS|MOX BANK|\\bIBFT\\b|\\bRTN\\b|GONCHARENKO|DMITRI|FPS|轉數快|TRANSFER|轉賬|自己|OWN ACCOUNT',
    category: null,
    txnClass: null,
  },

  // ---- category (CAT_RULES, первое совпадение) ----
  {
    priority: 100,
    ruleType: 'category',
    pattern:
      'LANDLORD|業主|房租|租金|\\bRENT\\b|按金|押金|物業|PROPERTY MGMT|MANAGEMENT FEE|管理費',
    category: 'Rent / Housing',
    txnClass: null,
  },
  {
    priority: 101,
    ruleType: 'category',
    pattern:
      '\\bSWIM\\b|SWIMMING|游泳|JUMANJI|SASHA|ALIAKSANDRA|WHOOP|SUUNTO|GARMIN|TRIATHLON|IRONMAN|LULULEMON|AKA SPORTS|\\bGYM\\b|FITNESS|YOGA|瑜伽|健身|马拉松|馬拉松|厦门challenge|XIAMEN CHALLENGE|CHALLENGE FAMILY',
    category: 'Sports & Fitness',
    txnClass: null,
  },
  {
    priority: 102,
    ruleType: 'category',
    pattern:
      '7[- ]?ELEVEN|SEVEN ELEVEN|OK便利店|CIRCLE K|VANGO|U[- ]?SELECT|便利店',
    category: 'Convenience Store',
    txnClass: null,
  },
  {
    priority: 103,
    ruleType: 'category',
    pattern:
      'PARKNSHOP|WELLCOME|惠康|百佳|DS GROCER|YATA|一田|FRESH UP|AEON|DON DON|DONKI|759|阿信屋|MARKET PLACE|大昌|FUSION|GREAT FOOD|TASTE|SUPERMARKET|CITYSUPER|JASONS|KONBINI|GROCER|SWIRE COCA|VITASOY',
    category: 'Groceries',
    txnClass: null,
  },
  {
    priority: 104,
    ruleType: 'category',
    pattern:
      'MCDONALD|STARBUCKS|\\bKFC\\b|PIZZA|BURGER|SUSHI|RAMEN|CAFE|COFFEE|RESTAURANT|RESTAURANTS|TEA|餐廳|茶餐廳|食|MT SUSHI|DOUGH BROS|YAU VEGGIE|VIESTA|OOLAA|TSUI WAH|譚仔|CAFE DE CORAL|大家樂|MX\\b|MAXIM|DELI|EATERY|BISTRO|NOODLE|HOTPOT|火鍋|BAKERY|麵包|餅',
    category: 'Dining & Cafe',
    txnClass: null,
  },
  {
    priority: 105,
    ruleType: 'category',
    pattern:
      'WATSON|MANNING|萬寧|屈臣氏|PHARMACY|藥|CLINIC|MEDICAL|DENTAL|醫|HOSPITAL|健康|OPTICAL|眼鏡|IHERB|SUPPLEMENT|VITAMIN|保健',
    category: 'Health & Pharmacy',
    txnClass: null,
  },
  {
    priority: 106,
    ruleType: 'category',
    pattern:
      '\\bMTR\\b|港鐵|\\bKMB\\b|CITYBUS|城巴|TAXI|的士|OCTOPUS|八達通|FERRY|渡輪|\\bUBER\\b|滴滴|DIDI|PARKING|停車|EFTPAY|CROSS HARBOUR|TUNNEL|MINIBUS|TRAM',
    category: 'Transport',
    txnClass: null,
  },
  {
    priority: 107,
    ruleType: 'category',
    pattern:
      'AIRLINE|AIRWAYS|CATHAY|HOTEL|酒店|民宿|RESORT|HOSTEL|RENAISSANCE|MARRIOTT|HILTON|HYATT|SHANGRI|RITZ|INTERCONTINENTAL|SHERATON|WESTIN|AIRPORT|機場|KLOOK|TRIP\\.COM|EXPEDIA|機票|AGODA|BOOKING\\.COM|RAILWAY|EXPRESS RAIL|高鐵',
    category: 'Travel',
    txnClass: null,
  },
  {
    priority: 108,
    ruleType: 'category',
    pattern:
      'CINEMA|戲院|MY CINEMA|OCEAN PARK|海洋公園|DISNEY|KIZTOPIA|樂園|KARAOKE|\\bK11\\b|\\bGAME\\b|LEGOLAND|\\bLEGO\\b|DISCOVERY CENTER|MUSEUM|拉普达|崎寻|花藝|花',
    category: 'Entertainment & Leisure',
    txnClass: null,
  },
  {
    priority: 109,
    ruleType: 'category',
    pattern:
      'MINISO|UNIQLO|\\bMUJI\\b|DECATHLON|\\bIKEA\\b|JAPAN HOME|大頭貼|LABELS|ZARA|H&M|INDITEX|APPLE|XIAOMI|小米|TAOBAO|淘宝|淘寶|TMALL|天猫|\\bTB\\d|旗舰店|旗艦店|BOOK|書|商店|MALL|百貨|DEPARTMENT|JHC|HOME CENTRE|JD\\.COM|京东|WETLAND|電器|莎莎|SASA|BONJOUR|TOPSHOP|商城|小岛',
    category: 'Shopping & Retail',
    txnClass: null,
  },
  {
    priority: 110,
    ruleType: 'category',
    pattern:
      '\\bCLP\\b|中電|HK ELECTRIC|港燈|TOWNGAS|煤氣|\\bCSL\\b|3HK|SMARTONE|CMHK|CHINA MOBILE|中國移動|中国移动|數碼通|電訊|WATER SUPP|水務|BROADBAND|NETVIGATOR|寬頻',
    category: 'Utilities & Telecom',
    txnClass: null,
  },
  {
    priority: 111,
    ruleType: 'category',
    pattern:
      'SCHOOL|學校|UNIVERSITY|大學|TUITION|學費|COURSE|教育|EDU\\b|LIBRARY|圖書',
    category: 'Education',
    txnClass: null,
  },
  {
    priority: 112,
    ruleType: 'category',
    pattern:
      'IVM TECH|OFFICE|EXPORTLOGISTICS|LOGISTIC|COURIER|快遞|順豐|\\bSF\\b|PRINT|印刷|LAUNDRY|洗衣|REPAIR|維修|SALON|髮|理髮|ALPHA CUT|BEAUTY|美容|NAIL|VISA SERVICE|PERSONALSERVICES|PERSONAL SERVICES|簽證',
    category: 'Services & Office',
    txnClass: null,
  },
];
