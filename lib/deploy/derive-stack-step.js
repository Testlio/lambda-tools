"use strict";

require('colors');
require('../helpers/string-additions');

const dot = require('dot');
const fs = require('fs');
const fsx = require('../helpers/fs-additions');
const path = require('path');
const Promise = require('bluebird');
const _ = require('lodash');

//
//  Step that derives the final CF stack configuration, based on
//  the information available in the context and combining it
//  with various templates found on disk
//
module.exports = function(context) {
    return new Promise(function(resolve) {
        process.stdout.write('\nBuilding stack configuration');

        // Prime the CF template
        const stackCF = fsx.readJSONFileSync(path.join(context.directories.root, 'templates', 'cf.json'));
        const deploymentCF = path.join(context.directories.staging, 'deployment.cf.json');

        // Merge with the template found in the service
        const customCF = path.join(context.directories.cwd, 'cf.json');
        if (fsx.fileExists(customCF)) {
            const customStackCF = fsx.readJSONFileSync(customCF);
            _.merge(stackCF, customStackCF);
        }

        // Project name parameter need to be set (as they include an allowedValues listing)
        stackCF["Parameters"]["aaProjectName"] = {
            "Type": "String",
            "Default": context.project.name,
            "AllowedValues": [
                context.project.name
            ]
        };

        // If there are additional Lamdba policies, add those
        const policyFile = path.join(context.directories.cwd, 'lambda_policies.json');
        if (fsx.fileExists(policyFile)) {
            const policies = [].concat(fsx.readJSONFileSync(policyFile));
            const current = stackCF["Resources"]["IamPolicyLambda"]["Properties"]["PolicyDocument"]["Statement"];
            stackCF["Resources"]["IamPolicyLambda"]["Properties"]["PolicyDocument"]["Statement"] = current.concat(policies);
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

            template["Properties"]["Code"] = {
                "S3Bucket": context.project.bucket,
                "S3Key": context.project.timestamp + '/' + lambda.name + '.zip'
            };

            const name = camelName.charAt(0).toUpperCase() + camelName.substring(1);
            const outputName = 'l' + name;
            stackCF["Outputs"][outputName] = JSON.parse(lambdaOutputTemplate({ name: name }));
            stackCF["Resources"][name] = template;
        });

        fs.writeFileSync(deploymentCF, JSON.stringify(stackCF));

        const ctx = _.clone(context);
        ctx.stack = _.assign({}, ctx.stack, {
            configuration: deploymentCF
        });

        console.log(' ✔'.green);
        resolve(ctx);
    });
};
