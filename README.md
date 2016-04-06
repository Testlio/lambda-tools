# Lambda tools

[![Circle CI](https://circleci.com/gh/Testlio/lambda-tools.svg?style=svg&circle-token=dc3e9529742ff948e2dd4ef4fa9c07d2622e5a21)](https://circleci.com/gh/Testlio/lambda-tools)

This repository contains a set of scripts that are useful when developing [AWS Lambda](https://aws.amazon.com/lambda/) backed microservices that rely on [AWS CloudFormation](https://aws.amazon.com/cloudformation/) and [AWS API Gateway](https://aws.amazon.com/api-gateway/).

## Installation

Install the tools via npm, this will make the following commands available in the directory that you ran the install command in (optionally, pass in `-g` to install the commands globally).

```
npm install @testlio/lambda-tools -g
```

## Setup

This step should only ever be run once for AWS account and region combination. The step will create the necessary Lambda function that acts as the CloudFormation resource for all stacks created by lambda-tools. The command assumes that you have configured [AWS CLI](https://aws.amazon.com/cli/) with your credentials and a default region. If no region is defined, `us-east-1` is assumed. **If this step is not done, services with an `api.json` file will fail to deploy.**

```
lambda setup [-r aws-region-name]
```

## Deploy

```
lambda deploy -n project-name [-s stage-to-deploy] [-r aws-region-to-deploy-to] [-e environment] [-h]
```

Deployment of a service to AWS, goes through multiple steps during the process:

1. Locally processes Lambda functions, using [browserify](http://browserify.org) and [uglify](https://github.com/mishoo/UglifyJS) to optimise the performance of the resulting functions
2. Generates a CloudFormation template that is used to raise/update a stack on AWS
3. Uploads Lambda function code, API definition (if any) and the compiled CloudFormation template to S3
4. Creates/Updates the CF stack using the template and assets in S3

## Deploy (Single Lambda)

```
lambda deploy-single -n function-name -f main.js [-r aws-region-to-deploy-to] [--env environment] [-h]
```

Deploying a single Lambda function directly to AWS Lambda. Processes the Lambda function as described in `deploy`, thus reducing the size of the function. Doesn't upload the function to S3.

### Authentication

`lambda deploy` and `lambda deploy-single` assume you have configured AWS credentials [that can be reached by the script](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html#Setting_AWS_Credentials). The script uses AWS SDK for Node.js, which is able to automatically pick up credentials from various places, thus, the script itself does not allow modifying/storing credentials.

## Execute

```
lambda execute [-e event-file] [-t timeout] [--env environment=value,foo=bar] [-h] [lambda-function]
```

Execute a single Lambda function with a specified event, timeout and environment. The `lambda-function` argument can be specified in multiple ways:

1. As a file path, in which case the file is assumed to be the handler
2. As a file name, in which case the file is expected to exist in the current directory
3. If executed inside of a service, `lambda-function` can be a name of the function to execute, i.e the name of the subdirectory in `lambdas`, where the Lambda function is.

In any of these cases, an event file is located as follows:

1. If a file argument was specified, it is checked relative to the location of the Lambda function (the location of the `index.js` being executed)
2. If the argument is specified, it is checked relative to the current working directory (the location where `lambda execute` is running from)
3. If neither of those exists, then an empty event is used as a fallback. Similarly, if either file fails to parse as valid JSON.

By default, the event file is assumed to be `event.json` and the timeout is set to 6 seconds. The environment is empty (i.e the running environment is not mirrored).

## Run

```
lambda run [-p port] [-e environment=value,foo=bar] [-a path-to-api-spec] [-h]
```

Running a Lambda backed microservice locally. This should be used strictly for development purposes as the code that simulates AWS is imperfect (at best) and is not guaranteed to respond similarly to the actual Lambda environment. It does however do its best to allow locally debugging lambda functions sitting behind an API gateway.

The command starts a local server, which parses the API spec (defaults to `./api.json`) and creates appropriate routes, all invalid routes return `404`. The server also mimics AWS's logic in creating the integration (i.e it maps the incoming HTTP request into an AWS Lambda integration), as well as mapping the result of the Lambda function into an appropriate HTTP response.

### Notes about microservice structure

In order for the scripts to work properly, the following structure is assumed for a microservice

```
Root Directory of the service
| api.json  - Swagger definition of the API to expose (optional)
| cf.json   - CloudFormation template for any additional resources or overrides
| lambda_policies.json - Additional AWS IAM policies for the Lambda functions (optional)
| package.json - By default all services are assumed to be NPM packages
| lambdas   - Directory containing Lambda functions, all subdirectories are treated as a function
    | lambda_name - Name of the directory is used as the name for the Lambda function
        | *.js    - JS files making up the Lambda function (default assumes index.js exists)
        | cf.json - Overrides for properties that are defined on Lambda function (allows overriding default index.js handler)
    | ...
```

As all Lambda functions are bundled and compressed during deployment, it is safe to share common code between Lambda functions in the top level of the microservice, for example in a directory called `common` or `lib`. Achieving this structure is easier by using [Yeoman](http://yeoman.io) and the [`@testlio/generator-lambda-tools` generators](https://www.npmjs.com/package/@testlio/generator-lambda-tools).

#### Examples

A minimal example of a service is implemented under [`examples/microservice`](examples/microservice).
