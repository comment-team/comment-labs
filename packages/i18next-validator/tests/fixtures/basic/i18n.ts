import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'


i18next
  .use(initReactI18next)
  .init({
    defaultNS: 'common',
    fallbackLng: 'en',
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json'
    }
  })

export default i18next
