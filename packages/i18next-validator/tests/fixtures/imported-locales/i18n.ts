import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import enCommon from './en-common.json'


i18next
  .use(initReactI18next)
  .init({
    defaultNS: 'common',
    fallbackLng: 'en',
    resources: {
      en: {
        common: enCommon
      }
    }
  })

export default i18next
