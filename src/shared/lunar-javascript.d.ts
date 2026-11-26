declare module 'lunar-javascript' {
  interface SolarDate {
    getYear(): number
    getMonth(): number
    getDay(): number
    getLunar(): LunarDate
  }

  interface LunarDate {
    getYear(): number
    getMonth(): number
    getDay(): number
    getMonthInChinese(): string
    getDayInChinese(): string
    getYearInGanZhi(): string
    getJieQi(): string
    getSolar(): SolarDate
  }

  export const Solar: { fromYmd(year: number, month: number, day: number): SolarDate }
  export const Lunar: { fromYmd(year: number, month: number, day: number): LunarDate }
}
