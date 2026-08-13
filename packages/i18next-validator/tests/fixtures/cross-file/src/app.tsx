import { RenderProp, renderLabel, translate } from './labels'


export function App() {
  return (
    <>
      {renderLabel('form.title')}
      {translate('direct.known')}
      <RenderProp key="jsx.known" />
    </>
  )
}
