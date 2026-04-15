import { dedent } from 'ts-dedent'


export function renovateTemplate(): string {
  return dedent`
    {
      "$schema": "https://docs.renovatebot.com/renovate-schema.json",
      "extends": [ "github>comment-team/comment-labs" ]
    }
  `
}
