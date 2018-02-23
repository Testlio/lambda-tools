![Banner](images/banner.png)

# Lambda Tools

[![Circle CI](https://circleci.com/gh/Testlio/lambda-tools.svg?style=shield&circle-token=dc3e9529742ff948e2dd4ef4fa9c07d2622e5a21)](https://circleci.com/gh/Testlio/lambda-tools) [![NPM](https://img.shields.io/npm/v/lambda-tools.svg?maxAge=3600)](https://npmjs.org/package/lambda-tools) [![NPM downloads](https://img.shields.io/npm/dm/lambda-tools.svg)](https://npmjs.org/package/lambda-tools)

This repository contains a set of scripts that are useful when developing [AWS Lambda](https://aws.amazon.com/lambda/) backed microservices that rely on [AWS CloudFormation](https://aws.amazon.com/cloudformation/) and [AWS API Gateway](https://aws.amazon.com/api-gateway/).

## Installation

Install the tools via npm, this will make the following commands available in the directory that you ran the install command in (optionally, pass in `-g` to install the commands globally).

```
npm install lambda-tools
```

### Configuration file

All scripts may make use of a `.lambda-tools-rc.json` file in the root of the project (that is, the location of `package.json` that is closest to Lambda functions). This allows defining some meaningful defaults for the scripts, such as a default stage, region and a project name. An example content of said file could be

```
{
    "project": {
        "name": "Project Name"
    },
    "lambda": {
        "runtime": "nodejs6.10"
    },
    "aws": {
        "region": "us-east-1",
        "stage": "dev"
    }
}
```

These defaults are used for deployment and running the service locally, which is useful for example when creating dynamic resource names that rely on the stage and project names.

### Expected Service Structure

In order for the scripts to work properly, the following structure is assumed for a service

```
.
├── api.json    - Swagger API definition (optional), used by lambda deploy and run
├── cf.json     - CloudFormation template, shouldn't include Lambda functions, API Gateway or IAM roles
├── lambda_policies.json - Additional AWS IAM policies for the Lambda functions (optional)
├── package.json - By default all services are assumed to be NPM packages
├── .lambda-tools-rc.json - Configuration file for lambda-tools, can contain default values for scripts to use
├── lambdas
│   └── lambda_name
│       ├── cf.json - Overrides for Lambda function properties (such as memory size or timeout length)
│       └── index.js - Default entrypoint for Lambda function (can be overriden by specifying handler in cf.json)
└── package.json
```

As all Lambda functions are bundled and compressed during deployment, it is safe to share common code between Lambda functions in the top level of the microservice, for example in a directory called `common` or `lib`. Achieving this structure is easier by using [Yeoman](http://yeoman.io) and the [`generator-lambda-tools` generators](https://www.npmjs.com/package/generator-lambda-tools).

#### Examples

A minimal example of a service is implemented under [`examples/microservice`](examples/microservice).

### AWS Credentials

All scripts assume that AWS credentials have been configured in a way that is [reachable by the AWS Node.js SDK](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html#Setting_AWS_Credentials). Lamba Tools does not provide a way to provide custom credentials.

#### IAM Permissions

The actions the user executing the scripts should be able to perform are:

1. `setup`
    1. `iam:GetRole`
    2. `iam:CreateRole`
    3. `iam:PutRolePolicy`
    4. `lambda:GetFunction`
    5. `lambda:CreateFunction`
    6. `lambda:UpdateFunctionCode`
    7. `lambda:UpdateFunctionConfiguration`
    7. `lambda:GetAlias`
    8. `lambda:UpdateAlias`
    9. `lambda:CreateAlias`
    10. `s3:ListBucket`
    11. `s3:CreateBucket`
2. `deploy`
    1. `s3:PutObject` - Can be limited to specific bucket (`lambda-tools-<major-version>-assets-<region>`)
    3. `cloudformation:DescribeStacks`
    4. `cloudformation:UpdateStack`
    5. `cloudformation:CreateStack`
    6. `lambda:*` - Required transitively by CloudFormation for creating the Lambda functions
    7. `apigateway:*` - Required transitively by CloudFormation for creating API Gateway instance
    6. \+ any permissions that are required by resources in the CloudFormation template
3. `deploy-single`
    1. `lambda:UpdateFunctionCode`
3. `run`
    1. N/A
4. `execute`
    1. N/A
5. `describe`
    1. N/A

## Setup

This step should only ever be run once for AWS account, region and LT version combination. The step will create the necessary Lambda functions that act as the CloudFormation resources for all stacks created by lambda-tools. If no region is defined, `us-east-1` is assumed. This also creates the staging S3 bucket that is used to store all stack assets. **If this step is not done, all deployments will fail**.

Since the deployed Lambda code is held in S3 buckets and S3 bucket names must be unique across all accounts, deploys will fail unless you provide an unique resource name prefix when running the `setup` command via the resource prefix option described below.

```
lambda setup [options]
```

### Options
```
-h, --help                      output usage information
-r, --region <string>           Region to setup in, if not set otherwise, defaults to 'us-east-1'
-p, --resource-prefix <string>  Prefix to use with all lambda-tools created AWS resources, defaults to '' (empty string)
--no-color                      Turn off ANSI coloring in output
```

## Describe

Print out an overview of the service in the current working directory. This helps understand which Lambda functions are connected to what CloudFormation resources.

```
lambda describe [options]
```

The output contains some metadata about the service, followed by a tree representing all Lambda functions and their respective triggers. This script goes over the CloudFormation template and looks at resources that are capable of triggering a Lambda function. In addition, it also looks at `api.json` to understand which Lambda functions are tied to the public API.

The description also includes Lambda functions that were found in the `lambdas` directory, but did not come up as being related to anything, this allows locating potentially unused functions.

It is worth noting that the Lambda functions are represented by their name (i.e the name of the directory they reside in) and as such, that name can also be directly used with `lambda execute`.

### Options
```
-h, --help       output usage information
-t, --tree-only  Only draw the Lambda usage tree, skipping metadata about the service
```

## Deployment

Deploying a service to AWS

```
lambda deploy [options]
```

Deployment of a service to AWS, goes through multiple steps during the process:

1. Locally processes Lambda functions, using [browserify](http://browserify.org) and [uglify](https://github.com/mishoo/UglifyJS) to optimise the performance of the resulting functions
2. Completes the CloudFormation template in `cf.json`. This is used for raising/updating the stack on AWS
3. Uploads Lambda function code, API definition (if any) and the compiled CloudFormation template to S3
4. Creates/Updates the CF stack using the template and assets in S3

### Options

```
-h, --help                 output usage information
-n, --project-name <name>  Project name
-s, --stage <stage>        Stage name
-r, --region <region>      Region
-e, --environment <env>    Environment Variables to embed as key-value pairs
--dry-run                  Simply generate files that would be used to update the stack and API
--exclude [list]           Packages to exclude from bundling
--clean                    Force a clean build where cached bundles are not used
--no-color                 Turn off ANSI coloring in output
```

### Lambda Configuration

Altering the configuration of Lambda functions that are deployed via CloudFormation can be done by creating a `cf.json` file inside of a Lambda function directory (i.e `lambdas/<name>`). This file can have the following structure:

```json
{
    "Properties": {
        // CloudFormation AWS::Lambda::Function Properties
    },
    "Assets": {
        // Any static assets that should be made available to the Lambda function
    }
}
```

For example, the following `cf.json` file sets the Lambda execution timeout to 30 seconds:

```json
{
    "Properties": {
        "Timeout": 30
    }
}
```

### Static Assets

The same `cf.json` file also handles static assets - files that are included in the bundled Lambda function as separate files. Generally, these may include templates and other files that the Lambda function would like to access on disk without bundling them directly into the source code.

These static assets are defined under the `Assets` key (notice the capitalization) as a key-value mapping, where keys are the expected paths in the bundle and the values are relative paths to the source file that should be included.

For example, a Lambda function with the following structure:

```
.
├── index.js
├── templates
│   └── response.txt
└── cf.json
```

May declare an `Assets` value as such:

```json
{
    "Assets": {
        "response_template.txt": "./templates/response.txt"
    }
}
```

Notice that the path in the bundle is flattened and no longer includes the subdirectory `templates`. In the Lambda function, the file can then be accessed as:

```js
const fs = require('fs');
console.log(fs.readFileSync('./response_template.txt', 'utf8')); // Prints out template
```

_It is important to emphasize, the source location of the mapped asset can also point to another directory - this allows reusing assets between Lambda functions, while also allowing these assets to have different names in specific Lambda functions._

### Source Maps

During deployment source maps for the transpiled/bundled code are generated and uploaded along with all other assets to S3. These will have the same name as the ZIP of the bundled code, but with a `.js.map` extension. In addition, the local staging directory will also include a source map for the non-transpiled version of the code (along with the original non-transpiled bundle code).

### Single Lambda

A single Lambda function can be deployed without using CloudFormation via `lambda deploy-single`. This simply updates the Lambda function code. **The script assumes that the Lambda function already exists and its configuration is suitable. This deployment script does not update the Lambda function configuration nor does it support static assets.**

```
lambda deploy-single function-name [options]
```

Deploying a single Lambda function directly to AWS Lambda. Processes the Lambda function as described in `deploy`, thus reducing the size of the function. Doesn't upload the function to S3. Assumes the handler of the function is in `index.handler`, you can change the entrypoint file via the `-f` option.

### Caching

Both `deploy` and `deploy-single` implement a caching logic to avoid the costly transpiling process of Lambda functions. This cache generates a manifest for the Lambda function by bundling all of its code into a single file and generating a checksum of it. The manifest also includes a dependency tree, which is used for `--exclude`. If the manifest matches the previous deployment, the ZIP file is reused. To circumvent this reuse policy, use the `--clean` flag, which forces a rebundling/transpiling.


## Execute

```
lambda execute [options] lambda-function
```

Execute a single Lambda function. The `lambda-function` argument can be specified in multiple ways:

1. As a file path, in which case the file is assumed to be the module that exports the `handler` function
2. As a file name, in which case the file is expected to exist in the current directory
3. If executed inside of a service, `lambda-function` can be the name of the function to execute, i.e the name of the subdirectory in `lambdas`, where the Lambda function is.

In any of these cases, an event file is located as follows:

1. Relative to the Lambda handler file location, if there is an `event.json` in the same directory
2. If the `-e` option is used, it is checked relative to the current working directory
3. If neither of those exists, then an empty event is used as a fallback. Similarly, if either file fails to parse as valid JSON.

By default, the event file is assumed to be `event.json` and the timeout is set to 6 seconds. The environment is empty (i.e the running environment is not mirrored).

### Options

```
-h, --help                  output usage information
-e, --event <file>          Path to the event JSON file, defaults to 'event.json'
--env, --environment <env>  Environment Variables to embed as key-value pairs
--timeout <timeout>         Timeout value for the Lambda function
--ignore-timeout            Ignore Lambda function timeout
--no-color                  Turn off ANSI coloring in output
```

## Run

```
lambda run [options]
```

Running a service locally. This should be used strictly for development purposes as the code that simulates AWS is imperfect (at best) and is not guaranteed to respond similarly to the actual Lambda environment. It does however do its best to allow locally debugging lambda functions sitting behind an API gateway.

The command starts a local server, which parses the API spec (defaults to `./api.json`) and creates appropriate routes, all invalid routes return `404`. The server also mimics AWS's logic in creating the integration (i.e it maps the incoming HTTP request into an AWS Lambda integration), as well as mapping the result of the Lambda function into an appropriate HTTP response.

### Options

```
-h, --help               output usage information
-p, --port <number>      Port to use locally
-a, --api-file <file>    Path to Swagger API spec (defaults to "./api.json")
-e, --environment <env>  Environment Variables to embed as key-value pairs
--mirror-environment     Mirror the environment visible to lambda-tools in the lambda functions
--timeout <number>       Timeout value for the Lambda functions (in seconds), overrides any function specific configuration
--ignore-timeout         Ignore Lambda function timeouts, overrides any function specific configuration
--no-color               Turn off ANSI coloring in output
```

### Note about execution

Both `lambda run` as well as `lambda execute` handle execution in a separate process, meaning the executing Lambda does not affect the main `lambda` script. Furthermore, both of the scripts also clean up after the Lambda function executes, i.e the file directory state is captured before and after, and all new files/folders are removed once execution finishes.

Lambda functions that are part of a service and have static assets defined in `cf.json` also expose those files as symlinks during execution via `execute` or `run`. These symlinks are also cleaned up once execution finishes.
