/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    AutomationContextAware,
    Configuration,
} from "@atomist/automation-client";
import { HandlerContext } from "@atomist/automation-client/HandlerContext";
import { guid } from "@atomist/automation-client/internal/util/string";
import { AutomationEventListenerSupport } from "@atomist/automation-client/server/AutomationEventListener";
import {
    addressEvent,
    CommandReferencingAction,
    Destination,
    isSlackMessage,
    MessageOptions,
    SlackDestination,
} from "@atomist/automation-client/spi/message/MessageClient";
import { Action } from "@atomist/slack-messages";
import * as _ from "lodash";
import * as cluster from "cluster";

/**
 * Root-type for the workspace-wide notifications
 */
const NotificationRootType = "Notification";

/**
 * Root-tyoe for the user notifications
 */
const UserNotificationRootType = "UserNotification";

interface UserNotification {
    ts: number;
    key: string;
    ttl: number;
    post: string;

    login: string;
    contentType: "text/plain" | "application/x-atomist-slack+json";
    body: string;
    actions: Action[];
}

interface Notification {
    ts: number;
    key: string;
    ttl: number;
    post: string;

    contentType: "text/plain" | "application/x-atomist-slack+json";
    body: string;
    actions: NotifactionAction[];
}

interface NotifactionAction {

    text: string;
    type: "button" | "menu";

    registration: string;
    command: string;
    parameters?: Array<{
        name: string;
        value: string;
    }>;

    parameterName?: string;
    parameterOptions?: Option[];
    parameterOptionGroups?: OptionGroup[];

    role?: "global" | "comment" | "react";
}

interface Option {
    name: string;
    value: string;
}

interface OptionGroup {
    name: string;
    options: Option[];
}

const LoginQuery = `query ChatIdByScreenName($teamId: ID, $screenName: String!) {
  ChatTeam(id: $teamId) {
    members(screenName: $screenName) {
      person {
        gitHubId {
          login
        }
      }
    }
  }
}
`;

export class DashboardAutomationEventListener extends AutomationEventListenerSupport {

    constructor(private readonly clustered: boolean) {
        super();
    }

    public messageSent(message: any,
                       destinations: Destination | Destination[],
                       options: MessageOptions,
                       ctx: HandlerContext): Promise<void> {
        // Only the master process should send these notifications
        if ((this.clustered && cluster.isWorker) || !this.clustered) {
            let ignore = false;
            if (options) {
                ignore = (options.id && options.id.includes("lifecycle"))
                    || (options as any).dashboard === false;
            }

            if (isSlackMessage(message) && !ignore) {

                const actions: NotifactionAction[] = _.flatten<Action>((message.attachments || []).map(a => a.actions))
                    .filter(a => a).map(a => {
                        const cra = a as any as CommandReferencingAction;

                        const parameters = [];
                        for (const key in cra.command.parameters) {
                            if (cra.command.parameters.hasOwnProperty(key)) {
                                parameters.push({
                                    name: key,
                                    value: cra.command.parameters[ key ] ? cra.command.parameters[ key ].toString() : undefined,
                                });
                            }
                        }

                        const action: NotifactionAction = {
                            text: cra.text,
                            type: "button",
                            registration: (ctx as any as AutomationContextAware).context.name,
                            command: cra.command.name,
                            parameters,
                        };
                        return action;
                    });

                const msg: Notification = {
                    key: options && options.id ? options.id : guid(),
                    ts: options && options.ts ? options.ts : Date.now(),
                    ttl: options ? options.ttl : undefined,
                    post: options ? options.post : undefined,
                    body: typeof message === "string" ? message : JSON.stringify(message),
                    contentType: typeof message === "string" ? "text/plain" : "application/x-atomist-slack+json",
                    actions,
                };

                if (!destinations || (destinations as Destination[]).length === 0) {
                    // Response message
                    if (ctx.source.user_agent as any === "web") {
                        return ctx.messageClient.send({
                            ..._.cloneDeep(msg) as Notification,
                            login: (ctx.source as any).web.login,
                        }, addressEvent(UserNotificationRootType));
                    } else if (ctx.source.user_agent === "slack") {
                        return ctx.graphClient.query({
                            query: LoginQuery,
                            variables: {
                                teamId: ctx.source.slack.team.id,
                                screenName: (ctx.source.slack.user as any).name,
                            },
                        })
                            .then(chatId => {
                                const login = _.get(chatId, "ChatTeam[0].members[0].person.gitHubId.login");
                                if (login) {
                                    return ctx.messageClient.send({
                                        ..._.cloneDeep(msg) as Notification,
                                        login,
                                    }, addressEvent(UserNotificationRootType));
                                } else {
                                    return Promise.resolve();
                                }
                            });
                    } else {
                        return ctx.messageClient.send(msg, addressEvent(NotificationRootType));
                    }
                } else {
                    // Addressed message
                    // channel-addressed will be send as workspace Notification
                    // user-addressed will be send as UserNotification in the workspace

                    const users: Array<{ teamId: string, screenName: string }> = [];
                    let channel: boolean = false;

                    const dest = Array.isArray(destinations) ? destinations : [ destinations ];

                    dest.forEach(d => {
                        const sd = d as SlackDestination;
                        if (sd.channels && sd.channels.length > 0) {
                            channel = true;
                        }
                        if (sd.users) {
                            users.push(...sd.users.map(u => ({ teamId: sd.team, screenName: u })));
                        }
                    });

                    const messages: Promise<void>[] = [];

                    if (channel) {
                        messages.push(ctx.messageClient.send(msg, addressEvent(NotificationRootType)));
                    }

                    if (users.length > 0) {
                        messages.push(..._.uniq(users).map(user => {

                            // We have the screenName but need the GitHub login
                            return ctx.graphClient.query({
                                query: LoginQuery,
                                variables: {
                                    teamId: user.teamId,
                                    screenName: user.screenName,
                                },
                            })
                                .then(chatId => {
                                    const login = _.get(chatId, "ChatTeam[0].members[0].person.gitHubId.login");
                                    if (login) {
                                        return ctx.messageClient.send({
                                            ..._.cloneDeep(msg) as Notification,
                                            login,
                                        }, addressEvent(UserNotificationRootType));
                                    } else {
                                        return Promise.resolve();
                                    }
                                });
                        }));
                    }

                    return Promise.all(messages)
                        .then(() => Promise.resolve());
                }
            }
        }
        return Promise.resolve();
    }
}

/**
 * Configure this automation client to send messages to Dashboard workspace and user notifications.
 * Note: Messages that are being send with 'options.dashboard = false' not forwarded as notifications.
 * @param {Configuration} configuration
 * @returns {Promise<Configuration>}
 */
export function configureDashboardNotifications(configuration: Configuration): Promise<Configuration> {
    configuration.listeners.push(new DashboardAutomationEventListener(configuration.cluster.enabled));
    return Promise.resolve(configuration);
}
