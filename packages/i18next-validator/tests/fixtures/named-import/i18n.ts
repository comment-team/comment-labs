import { init, use } from 'i18next'


export const defaultNS = 'translation'

const languagesListNS = 'languages'

use({
  type: 'languageDetector',
  init: () => null,
  detect: (): string => 'en',
  cacheUserLanguage: () => null
})

function prefix(path: string): string {
  return `/static${path}`
}

init({
  defaultNS,
  fallbackLng: 'en',
  ns: [ defaultNS, languagesListNS, 'lab' ],

  backend: {
    loadPath: prefix('/locales/{{lng}}/{{ns}}.json')
      .replaceAll('%7B', '{')
      .replaceAll('%7D', '}')
  }
})
