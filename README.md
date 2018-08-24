# @atomist/automation-client-ext-dashboard

An extension to an Atomist automation-client to forward Slack messages (DM or channel messages)
to the Atomist Dashboard running at https://app.atomist.com.

## Usage

1. First install the dependency in your automation-client project

```
$ npm install @atomist/automation-client-ext-dashboard
```

2. Install the support in your `atomist.config.ts`

```
import { configureDashboardNotifications } from "@atomist/automation-client-ext-dashboard";

export const configuration: Configuration = {
    postProcessors: [
        configureDashboardNotifications,
    ],
}
```

## Support

General support questions should be discussed in the `#support`
channel on our community Slack team
at [atomist-community.slack.com][slack].

If you find a problem, please create an [issue][].

[issue]: https://github.com/atomist/automation-client-ext-dashboard/issues

## Development

You will need to install [node][] to build and test this project.

### Build and Test

Command | Reason
------- | ------
`npm install` | install all the required packages
`npm run build` | lint, compile, and test
`npm run lint` | run tslint against the TypeScript
`npm run compile` | compile all TypeScript into JavaScript
`npm test` | run tests and ensure everything is working
`npm run clean` | remove stray compiled JavaScript files and build directory

---

Created by [Atomist][atomist].
Need Help?  [Join our Slack team][slack].

[atomist]: https://atomist.com/ (Atomist - Development Automation)
[slack]: https://join.atomist.com/ (Atomist Community Slack)
