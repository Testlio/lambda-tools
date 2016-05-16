'use strict';

const _ = require('lodash');
const cfDependencies = require('./cf-template-functions');

/**
 *  Helper module for parsing out all Lambda triggering resources
 *  from a CloudFormation template
 *
 *  @param template, CloudFormation template object
 *  @return {object} keys are resources, values are arrays of Lambda resources (name or ARN)
 */
module.exports = function(template) {
    // Only certain types of resources have the ability to trigger a Lambda function
    // each of those has slightly different structure to them
    const triggers = {
        'AWS::Events::Rule': {
            lambdas: function(value) {
                return _.flatten(_.get(value, 'Properties.Targets', []).map(function(target) {
                    return cfDependencies(target.Arn).map(function(dep) {
                        return dep;
                    });
                }));
            }
        },
        'AWS::Lambda::EventSourceMapping': {
            lambdas: function(value) {
                const functionName = _.get(value, 'Properties.FunctionName');
                if (functionName) {
                    return cfDependencies(functionName);
                }
            }
        },
        'AWS::S3::Bucket': {
            lambdas: function(value) {
                const notifications = _.get(value, 'Properties.NotificationConfiguration.LambdaConfigurations');
                if (notifications) {
                    return _.flatten(notifications.map(function(notif) {
                        return cfDependencies(notif.Function);
                    }));
                }
            }
        },
        'AWS::SNS::Topic': {
            lambdas: function(value) {
                const subscriptions = _.get(value, 'Properties.Subscription', []).filter(function(sub) {
                    return sub.Protocol === 'lambda';
                });

                if (subscriptions) {
                    return _.flatten(subscriptions.map(function(sub) {
                        return cfDependencies(sub.Endpoint);
                    }));
                }
            }
        },
        'AWS::ApiGateway::Authorizer': {
            lambdas: function(value) {
                const type = _.get(value, 'Properties.Type');
                if (type !== 'TOKEN') {
                    return [];
                }

                return cfDependencies(_.get(value, 'Properties.AuthorizerUri'));
            }
        }
    };

    const types = _.keys(triggers);
    const resources = _.pickBy(template.Resources, function(value) {
        return _.indexOf(types, value.Type) !== -1;
    });

    return _.mapValues(resources, function(value) {
        return triggers[value.Type].lambdas(value);
    });
};
