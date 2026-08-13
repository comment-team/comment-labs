export function WelcomePage() {
  const greeting = 'Hello'
  const uppercaseOnly = 'ABC'

  return (
    <div>
      <h1>Welcome</h1>
      <p className="lead">This is a description</p>
      <button type="button" title="Click me">Submit</button>
      <input placeholder="Enter name" />
      <span>{greeting}</span>
      <span>{uppercaseOnly}</span>
    </div>
  )
}
