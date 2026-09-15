#!/usr/bin/env swift
/**
 Create ML trainer for Non-Standard Outside Wire recognition (macOS only).

 Run on a Mac with Xcode:
   cd ml/wire-visual-intelligence
   swift scripts/train_createml.swift

 Expects Create ML folder layout under dataset/training and dataset/validation.
 Writes models/NonStandardOutsideWireClassifier.mlmodel
*/

import CreateML
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let trainURL = root.appendingPathComponent("dataset/training")
let valURL = root.appendingPathComponent("dataset/validation")
let outURL = root.appendingPathComponent("models/NonStandardOutsideWireClassifier.mlmodel")

do {
    let parameters = MLImageClassifier.ModelParameters(
        validation: .table(at: valURL),
        maxIterations: 25,
        augmentation: [.crop, .rotation, .exposure, .blur],
        algorithm: .transferLearning(
            featureExtractor: .scenePrint(revision: 2),
            classifier: .logisticRegressor
        )
    )

    let classifier = try MLImageClassifier(
        trainingData: .labeledDirectories(at: trainURL),
        parameters: parameters
    )

    let metadata = MLModelMetadata(
        author: "Hazard Reporter",
        shortDescription: "Recognizes non-standard outside wires for Visual Intelligence.",
        version: "1.0.0"
    )
    try FileManager.default.createDirectory(
        at: outURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    try classifier.write(to: outURL, metadata: metadata)
    print("Wrote \(outURL.path)")
    print(classifier.evaluation(on: .labeledDirectories(at: valURL)))
} catch {
    fputs("Create ML training failed: \(error)\n", stderr)
    exit(1)
}
