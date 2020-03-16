#!/bin/bash
versions=3.16.3,3.17.0

script_path=`dirname $0`
compilers_path=$(cd $script_path/../compilers; pwd)
mkdir -p $compilers_path
curl -o "$compilers_path/ember-template-compiler_#1.js" "https://unpkg.com/ember-source@{$versions}/dist/ember-template-compiler.js"
