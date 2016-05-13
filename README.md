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
        "runtime": "nodejs4.3"
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

### Setup

This step should only ever be run once for AWS account, region and LT version combination. The step will create the necessary Lambda functions that act as the CloudFormation resources for all stacks created by lambda-tools. If no region is defined, `us-east-1` is assumed. This also creates the staging S3 bucket that is used to store all stack assets. **If this step is not done, all deployments will fail**.

```
lambda setup [options]
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

### Single Lambda

A single Lambda function can be deployed without using CloudFormation via `lambda deploy-single`. This simply updates the Lambda function code. **The script assumes that the Lambda function already exists.**

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

## Run

```
lambda run [options]
```

Running a service locally. This should be used strictly for development purposes as the code that simulates AWS is imperfect (at best) and is not guaranteed to respond similarly to the actual Lambda environment. It does however do its best to allow locally debugging lambda functions sitting behind an API gateway.

The command starts a local server, which parses the API spec (defaults to `./api.json`) and creates appropriate routes, all invalid routes return `404`. The server also mimics AWS's logic in creating the integration (i.e it maps the incoming HTTP request into an AWS Lambda integration), as well as mapping the result of the Lambda function into an appropriate HTTP response.
