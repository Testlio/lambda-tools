'use strict';

require('colors');
require('../helpers/string-additions');

const dot = require('dot');
const fs = require('fs');
const fsx = require('../helpers/fs-additions');
const path = require('path');
const Promise = require('bluebird');
const _ = require('lodash');

function loadTemplate(context) {
    return new Promise(function(resolve) {
        // Result
        const stackCF = fsx.readJSONFileSync(path.join(context.directories.root, 'templates', 'cf.json'));
        const customCF = path.join(context.directories.cwd, 'cf.json');

        // If file exists, load that in
        if (fsx.fileExists(customCF)) {
            const customStackCF = fsx.readJSONFileSync(customCF);
            _.merge(stackCF, customStackCF);
        }

        // Project name parameter need to be set (as they include an allowedValues listing)
        stackCF['Parameters']['aaProjectName'] = {
            Type: 'String',
            Default: context.project.name,
            AllowedValues: [
                context.project.name
            ]
        };

        resolve({
            context: context,
            stack: stackCF
        });
    });
}

function loadLambdas(result) {
    const context = result.context;
    const stack = result.stack;

    // If there are additional Lamdba policies, add those
    const policyFile = path.join(context.directories.cwd, 'lambda_policies.json');
    if (fsx.fileExists(policyFile)) {
        const policies = [].concat(fsx.readJSONFileSync(policyFile));
        const current = stack['Resources']['IamPolicyLambda']['Properties']['PolicyDocument']['Statement'];
        stack['Resources']['IamPolicyLambda']['Properties']['PolicyDocument']['Statement'] = current.concat(policies);
    }

    // Add Lambdas
    const lambdaConfigurationTemplate = fsx.readJSONFileSync(path.join(context.directories.root, 'templates/lambda.cf.json'));
    const lambdaOutputTemplate = dot.template(fs.readFileSync(path.join(context.directories.root, 'templates/lambda.resource.dot'), 'utf8'));

    context.lambdas.forEach(function(lambda) {
        const camelName = lambda.name.toCamelCase();

        // Check if further config exists
        const template = _.clone(lambdaConfigurationTemplate, true);

        if (lambda.config) {
            _.merge(template, fsx.readJSONFileSync(lambda.config));
        }

        template['Properties']['Code'] = {
            'S3Bucket': context.project.bucket,
            'S3Key': context.project.timestamp + '/' + lambda.name + '.zip'
        };

        const name = camelName.charAt(0).toUpperCase() + camelName.substring(1);
        const outputName = 'l' + name;
        stack['Outputs'][outputName] = JSON.parse(lambdaOutputTemplate({ name: name }));
        stack['Resources'][name] = template;
    });

    return {
        context: context,
        stack: stack
    };
}

function loadAPI(result) {
    const context = result.context;
    const stack = result.stack;

    if (context.api.skip) {
        return result;
    }

    const template = dot.template(fs.readFileSync(path.join(context.directories.root, 'templates/api.cf.dot'), 'utf8'));

    const version = require('../../package.json').version;
    const alias = _.kebabCase('lambda-tools-' + version);

    // Variables in our case are a list of resources for which we want to grab ARNs
    const variables = [];
    const dependencies = [];

    context.lambdas.forEach(function(lambda) {
        const camelName = lambda.name.toCamelCase();
        const name = camelName.charAt(0).toUpperCase() + camelName.substring(1);

        variables.push({
            key: 'l' + name,
            value: name,
            lambda: true
        });

        dependencies.push(name);
    });

    // Carry over two of the IAM roles as well
    variables.push({
        key: 'IamRoleArnLambda',
        value: 'IamRoleLambda'
    });

    dependencies.push('IamRoleLambda');

    variables.push({
        key: 'IamRoleArnApiGateway',
        value: 'IamRoleApiGateway'
    });

    dependencies.push('IamRoleApiGateway');

    // Populate a template that will make our custom API Gateway resource
    const parsedTemplate = template({
        lambda: {
            name: 'lambda-tools-api-gateway-resource',
            alias: alias
        },
        dependencies: dependencies,
        stageName: _.snakeCase(context.project.stage),
        s3: {
            bucket: context.project.bucket,
            key: context.project.timestamp + '/' + path.basename(context.api.configuration)
        },
        variables: variables
    });

    stack['Resources']['LambdaToolsAPIGateway'] = JSON.parse(parsedTemplate);

    return {
        context: context,
        stack: stack
    };
}

function saveStackConfiguration(result) {
    const context = result.context;
    const stack = result.stack;

    const deploymentCF = path.join(context.directories.staging, 'deployment.cf.json');
    fs.writeFileSync(deploymentCF, JSON.stringify(stack));

    const ctx = _.clone(context);
    ctx.stack = _.assign({}, ctx.stack, {
        configuration: deploymentCF
    });

    return ctx;
}

//
//  Step that derives the final CF stack configuration, based on
//  the information available in the context and combining it
//  with various templates found on disk
//
module.exports = function(context) {
    process.stdout.write('\nBuilding stack configuration');

    return loadTemplate(context)
        .then(loadLambdas)
        .then(loadAPI)
        .then(saveStackConfiguration)
        .then(function(ctx) {
            console.log(' ✔'.green);
            return ctx;
        });
};
