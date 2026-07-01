from deepforest import main

model = main.deepforest()
model.load_model()

predictions = model.predict_image(path="highresimg.png")

print(predictions)