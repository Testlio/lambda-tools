'use strict';

const dot = require('dot');
const fs = require('graceful-fs');
const fsx = require('../helpers/fs-additions');
const path = require('path');
const Promise = require('bluebird');
const _ = require('lodash');

const config = require('../helpers/config');

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

    // Templates
    const lambdaOutputTemplate = dot.template(fs.readFileSync(path.join(context.directories.root, 'templates/lambda.resource.dot'), 'utf8'));
    const lambdaVersionTemplate = dot.template(fs.readFileSync(path.join(context.directories.root, 'templates/lambda.version.dot'), 'utf8'));
    const lambdaPermissionTemplate = dot.template(fs.readFileSync(path.join(context.directories.root, 'templates/lambda.permission.dot'), 'utf8'));

    // Version description is the timestamp of the current deployment
    const timestamp = context.project.timestamp;

    // Add Lambdas to CF stack
    context.lambdas.forEach(function(lambda) {
        let camelName = _.camelCase(lambda.name);
        camelName = camelName.charAt(0).toUpperCase() + camelName.substring(1);

        const outputName = 'l' + camelName;
        stack['Resources'][camelName] = lambda.config;

        // Version
        const versionName = camelName + 'Version' + config.tools.majorVersion;
        stack['Resources'][versionName] = JSON.parse(lambdaVersionTemplate({
            resource: config.tools.resources.lambdaVersion,
            lambda: camelName,
            description: timestamp
        }));

        // Permission
        const permissionName = camelName + 'APIGPermission';
        stack['Resources'][permissionName] = JSON.parse(lambdaPermissionTemplate({
            lambda: versionName
        }));

        // Final output (used by API Gateway)
        stack['Outputs'][outputName] = JSON.parse(lambdaOutputTemplate({ name: versionName }));
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

    // Variables in our case are a list of resources for which we want to grab ARNs
    const variables = [];
    const dependencies = [];

    context.lambdas.forEach(function(lambda) {
        const camelName = _.camelCase(lambda.name);
        const name = camelName.charAt(0).toUpperCase() + camelName.substring(1);
        const version = name + 'Version' + config.tools.majorVersion;

        variables.push({
            key: 'l' + name,
            value: version,
            lambda: true
        });

        dependencies.push(version);
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
            name: config.tools.resources.apiGateway
        },
        dependencies: dependencies,
        stageName: _.snakeCase(context.project.stage),
        s3: {
            bucket: context.project.bucket,
            key: context.project.timestamp + '/' + path.basename(context.api.configuration)
        },
        variables: variables
    });

    stack['Resources']['LambdaToolsAPIGateway' + config.tools.majorVersion] = JSON.parse(parsedTemplate);

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
    return context.logger.task('Deriving stack configuration', function(resolve, reject) {
        loadTemplate(context)
            .then(loadLambdas)
            .then(loadAPI)
            .then(saveStackConfiguration)
            .then(resolve, reject);
    });
};
